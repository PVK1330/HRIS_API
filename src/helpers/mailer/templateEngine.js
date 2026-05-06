"use strict";
const TOKEN_RE = /\{\{\{?\s*([a-zA-Z_][\w]*)\s*\}?\}\}/g;

function render(templateHtml, variables = {}) {
  if (templateHtml == null) return "";
  const vars = variables || {};

  return String(templateHtml).replace(TOKEN_RE, (_match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const v = vars[key];
      return v === null || v === undefined ? "" : String(v);
    }
    return "";
  });
}

module.exports = {
  render,
};
