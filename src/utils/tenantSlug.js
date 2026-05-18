"use strict";

function slugifyTenantName(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "");
}

module.exports = { slugifyTenantName };
