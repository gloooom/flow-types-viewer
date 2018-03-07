const exec = require('child_process').execSync;
const crypto = require('crypto');
const fs = require('fs');


const typeToString = (type) => {
  switch (type.type) {
    case 'NumberTypeAnnotation':
      return 'number';
    case 'StringTypeAnnotation':
      return 'string';
    case 'BooleanTypeAnnotation':
      return 'boolean';
    case 'GenericTypeAnnotation':
      return `${type.id.name}${
        type.typeParameters ? `<${type.typeParameters.params.map(typeToString).join(', ')}>` : ''
        }`;
    case 'IntersectionTypeAnnotation':
      return type.types.map(typeToString).join(' & ');
    case 'ObjectTypeAnnotation':
      return `{ ${type.properties.map((prop) => `${prop.key.name}${prop.optional ? '?' : ''}: ${typeToString(prop.value)}`).join(', ')} }`;
    case 'ExistsTypeAnnotation':
      return '*';
    default:
      return '';
  }
};

const getGenericTypes = (type) => {
  switch (type.type) {
    case 'GenericTypeAnnotation':
      return [type.id.name, ...(type.typeParameters ? type.typeParameters.params.map(getGenericTypes) : [])];
    case 'IntersectionTypeAnnotation':
      return type.types.reduce((acc, prop) => [...acc, ...getGenericTypes(prop)], []);
    case 'ObjectTypeAnnotation':
      return type.properties.reduce((acc, prop) => [...acc, ...getGenericTypes(prop.value)], []);
    default:
      return [];
  }
};

const findTypeImports = (body) => body
  .filter(({type, importKind}) => type === 'ImportDeclaration' && importKind === 'type')
  .reduce((acc, item) => {
    acc.push(...item.specifiers.map((specifier) => ({
      name: specifier.imported.name,
      path: item.source.value
    })));

    return acc;
  }, []);


const getFileAST = (url) => {
  if (url && getFileAST.memory.has(url)) {
    return getFileAST.memory.get(url);
  }

  const ast = JSON.parse(exec(`flow ast ${url}`)).body;

  if (url) {
    getFileAST.memory.set(url, ast);
  }

  return ast;
};

getFileAST.memory = new Map();

const getFile = (path) => {
  if (path && !/^[a-zA-Z0-9\-]+$/.test(path)) {
    if (getFile.memory.has(path)) {
      return getFile.memory.get(path);
    } else {
      const file = fs.readFileSync(path).toString();

      getFile.memory.set(path, file);

      return file;
    }
  }

  return '';
};

getFile.memory = new Map();

const getAST = (content) => {
  const fileName = crypto.createCipher('aes192', content).final('hex');
  const dir = 'temp';
  const path = `${dir}/${fileName}`;

  try {
    fs.mkdirSync(dir);
  } catch (err) {

  }

  fs.writeFileSync(path, content);

  return JSON.parse(exec(`flow ast ${path}`)).body;
};


const getDeepImports = (ast, relativePath, acc = {}) => {
  const typeImports = findTypeImports(ast);

  return typeImports.reduce((acc, type) => {
    const importPath = resolveImportPath(type.path, relativePath);

    if (acc[importPath] == null) {
      if (importPath) {
        const fileAST = getFileAST(importPath);

        acc[importPath] = fileAST;

        getDeepImports(fileAST, importPath, acc);
      } else {
        acc[type.path] = null;
      }
    }

    return acc;
  }, acc);
};

const clearImports = (code) => (
  code && code
    .replace(/(^import type.*?'.*?\/+.*?'.*?$)|(^\/\/.*?@flow$)/mig, '')
    .replace(/^export (default)?/igm, '')
);

const resolveImports = (astNodes, path) => (
  astNodes.map((node) => node.type === 'ImportDeclaration' ? (
    Object.assign(node, {
      source: Object.assign(node.source, {
        value: resolveImportPath(node.source.value, path)
      })
    })
  ) : node)
);

const resolveImportPath = (path, parentPath) => {
  const isExternal = /^rc-web-types.*?/.test(path);
  const isNodeModule = /^[a-zA-Z0-9\-_]+$/.test(path);
  const clearedPath = path.replace(/^\.\//, '');
  const clearedParentPath = parentPath && parentPath.replace(/\/[a-zA-Z0-9\-_]*?\.js\.flow/, '/');

  console.log(path, 'in', parentPath);
  if (isNodeModule) {
    return null;
  } else if (isExternal || !parentPath) {
    return './node_modules/' + clearedPath + '.js.flow';
  } else {
    return parentPath ? (
      clearedParentPath + clearedPath + '.js.flow'
    ) : path;
  }
};


const makeAST = (...paths) => {
  const imports = paths.reduce((acc, path) => {
    acc[path] = getFileAST(path);

    return acc;
  }, {});


  Object.entries(imports)
    .forEach(([path, entry]) => getDeepImports(
      entry,
      path,
      imports
    ));

  return Object.entries(imports)
    .reduce((acc, [key, value]) => {
      acc[key] = value && resolveImports(value, key);

      return acc;
    }, {});
};

module.exports = {
  makeAST
};
