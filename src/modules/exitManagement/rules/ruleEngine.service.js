'use strict';

/**
 * Evaluates a set of JSONB conditions against a context
 * Conditions format: 
 * {
 *   operator: "AND" | "OR",
 *   rules: [
 *     { field: "designation", operator: "eq", value: "Manager" },
 *     { field: "has_assets", operator: "eq", value: true }
 *   ]
 * }
 */
function evaluateConditions(conditions, context) {
  if (!conditions || !conditions.rules || conditions.rules.length === 0) {
    return true; // No conditions = evaluates to true (always run)
  }

  const { operator = 'AND', rules } = conditions;

  const evaluateRule = (rule) => {
    const contextValue = context[rule.field];
    
    switch(rule.operator) {
      case 'eq': return contextValue === rule.value;
      case 'neq': return contextValue !== rule.value;
      case 'gt': return contextValue > rule.value;
      case 'lt': return contextValue < rule.value;
      case 'gte': return contextValue >= rule.value;
      case 'lte': return contextValue <= rule.value;
      case 'in': return Array.isArray(rule.value) && rule.value.includes(contextValue);
      default: return false;
    }
  };

  if (operator === 'AND') {
    return rules.every(evaluateRule);
  } else if (operator === 'OR') {
    return rules.some(evaluateRule);
  }
  
  return true;
}

module.exports = {
  evaluateConditions
};
