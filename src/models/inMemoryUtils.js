const { randomUUID } = require('crypto');

function generateId() {
  return randomUUID();
}

function toIdString(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
}

function cloneValue(value) {
  if (value == null) return value;
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === 'function') continue;
      result[key] = cloneValue(val);
    }
    return result;
  }
  return value;
}

function getByPath(obj, path) {
  if (!obj) return undefined;
  if (!path || typeof path !== 'string') {
    return obj[path];
  }
  return path.split('.').reduce((acc, key) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) {
      const index = Number(key);
      if (Number.isInteger(index)) {
        return acc[index];
      }
    }
    return acc[key];
  }, obj);
}

function setByPath(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    let next = Array.isArray(current)
      ? current[Number(key)]
      : current[key];
    if (next == null) {
      const nextKey = keys[i + 1];
      const isIndex = Number.isInteger(Number(nextKey));
      next = isIndex ? [] : {};
      if (Array.isArray(current)) {
        current[Number(key)] = next;
      } else {
        current[key] = next;
      }
    }
    current = next;
  }
  const lastKey = keys[keys.length - 1];
  if (Array.isArray(current)) {
    current[Number(lastKey)] = value;
  } else {
    current[lastKey] = value;
  }
}

function pushByPath(obj, path, value) {
  const target = getByPath(obj, path);
  if (Array.isArray(target)) {
    target.push(value);
    return;
  }
  if (target == null) {
    setByPath(obj, path, [value]);
    return;
  }
  throw new Error(`Cannot $push to non-array path: ${path}`);
}

function valueMatches(target, condition) {
  if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
    if ('$in' in condition) {
      const list = condition.$in || [];
      if (Array.isArray(target)) {
        const targetStrings = target.map(toIdString);
        return list.some((val) => targetStrings.includes(toIdString(val)));
      }
      return list.map(toIdString).includes(toIdString(target));
    }
    if ('$exists' in condition) {
      const exists = target !== undefined && target !== null;
      return condition.$exists ? exists : !exists;
    }
    // Nested query
    return Object.entries(condition).every(([key, val]) => {
      const nested = getByPath(target, key);
      return valueMatches(nested, val);
    });
  }

  if (Array.isArray(target)) {
    return target.some((val) => toIdString(val) === toIdString(condition));
  }

  return toIdString(target) === toIdString(condition);
}

function matchesQuery(doc, query = {}) {
  if (!query || Object.keys(query).length === 0) return true;

  return Object.entries(query).every(([key, value]) => {
    if (key === '$or' && Array.isArray(value)) {
      return value.some((sub) => matchesQuery(doc, sub));
    }
    if (key === '$and' && Array.isArray(value)) {
      return value.every((sub) => matchesQuery(doc, sub));
    }
    const docValue = getByPath(doc, key);
    return valueMatches(docValue, value);
  });
}

function applyUpdate(doc, update = {}) {
  if (!update || typeof update !== 'object') return doc;
  if (update.$set) {
    for (const [path, value] of Object.entries(update.$set)) {
      setByPath(doc, path, value);
    }
  }
  if (update.$push) {
    for (const [path, value] of Object.entries(update.$push)) {
      pushByPath(doc, path, value);
    }
  }
  const directEntries = Object.entries(update).filter(([key]) => !key.startsWith('$'));
  for (const [key, value] of directEntries) {
    doc[key] = value;
  }
  return doc;
}

function parseSelect(fields) {
  if (!fields) return null;
  if (typeof fields === 'string') {
    const tokens = fields.split(/\s+/).filter(Boolean);
    return new Set(tokens);
  }
  if (Array.isArray(fields)) {
    return new Set(fields);
  }
  if (typeof fields === 'object') {
    const included = Object.entries(fields)
      .filter(([, val]) => Boolean(val))
      .map(([key]) => key);
    return new Set(included);
  }
  return null;
}

function applySelect(obj, selectSet) {
  if (!selectSet || selectSet.size === 0 || !obj) return obj;
  const result = {};
  selectSet.forEach((field) => {
    if (field === '_id') {
      result._id = cloneValue(obj._id);
      return;
    }
    const value = getByPath(obj, field);
    if (value !== undefined) {
      setByPath(result, field, cloneValue(value));
    }
  });
  if (!selectSet.has('_id') && obj._id !== undefined) {
    result._id = cloneValue(obj._id);
  }
  return result;
}

function compareValues(a, b) {
  const valA = a instanceof Date ? a.getTime() : a;
  const valB = b instanceof Date ? b.getTime() : b;
  if (valA < valB) return -1;
  if (valA > valB) return 1;
  return 0;
}

class QueryBase {
  constructor(model, docs, { multi = false, fromList = false } = {}) {
    this.model = model;
    this.docs = docs;
    this.multi = multi;
    this.fromList = fromList;
    this._lean = false;
    this._select = null;
    this._populate = [];
    this._sort = null;
  }

  select(fields) {
    this._select = parseSelect(fields);
    return this;
  }

  lean() {
    this._lean = true;
    return this;
  }

  populate(path) {
    if (Array.isArray(path)) {
      this._populate.push(...path);
    } else if (typeof path === 'string') {
      this._populate.push(path);
    }
    return this;
  }

  sort(spec) {
    this._sort = spec;
    return this;
  }

  async exec() {
    let docsArray;
    if (this.multi) {
      docsArray = Array.isArray(this.docs) ? [...this.docs] : [];
      if (this._sort && typeof this._sort === 'object') {
        const entries = Object.entries(this._sort);
        docsArray.sort((a, b) => {
          for (const [field, direction] of entries) {
            const aVal = getByPath(a, field);
            const bVal = getByPath(b, field);
            const cmp = compareValues(aVal, bVal);
            if (cmp !== 0) {
              return direction < 0 ? -cmp : cmp;
            }
          }
          return 0;
        });
      }
      if (!this._lean && this._select) {
        // For non-lean queries, return shallow clones when select is used to avoid mutating originals
        docsArray = docsArray.map((doc) => this.model._selectOnDocument(doc, this._select));
      }
    } else if (this.fromList) {
      docsArray = Array.isArray(this.docs) ? [...this.docs] : [];
      if (this._sort && typeof this._sort === 'object') {
        const entries = Object.entries(this._sort);
        docsArray.sort((a, b) => {
          for (const [field, direction] of entries) {
            const aVal = getByPath(a, field);
            const bVal = getByPath(b, field);
            const cmp = compareValues(aVal, bVal);
            if (cmp !== 0) {
              return direction < 0 ? -cmp : cmp;
            }
          }
          return 0;
        });
      }
      docsArray = docsArray.length > 0 ? [docsArray[0]] : [];
    } else {
      docsArray = this.docs ? [this.docs] : [];
    }

    let processed = await Promise.all(docsArray.map(async (doc) => {
      if (!doc) return null;
      let targetDoc = doc;
      for (const path of this._populate) {
        targetDoc = await this.model._populateDocument(targetDoc, path, { lean: this._lean });
      }
      if (this._lean) {
        const plain = this.model._toObject(targetDoc);
        return this._select ? applySelect(plain, this._select) : plain;
      }
      if (this._select) {
        return this.model._selectOnDocument(targetDoc, this._select);
      }
      return targetDoc;
    }));

    processed = processed.filter((doc) => doc != null);

    if (this.multi) {
      return processed;
    }
    return processed.length > 0 ? processed[0] : null;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }
}

module.exports = {
  generateId,
  toIdString,
  cloneValue,
  getByPath,
  setByPath,
  pushByPath,
  matchesQuery,
  applyUpdate,
  parseSelect,
  applySelect,
  QueryBase,
};
