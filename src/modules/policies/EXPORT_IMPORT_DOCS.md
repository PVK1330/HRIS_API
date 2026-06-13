# Policy Export & Import API Documentation

Professional export and import functionality for bulk policy management in HRIS.

## Table of Contents
1. [Export Endpoints](#export-endpoints)
2. [Import Endpoints](#import-endpoints)
3. [CSV Format Specification](#csv-format-specification)
4. [Error Handling](#error-handling)
5. [Examples](#examples)

---

## Export Endpoints

### 1. Export Single Policy Acknowledgements

Export acknowledgement tracking for a single policy in multiple formats.

**Endpoint:**
```
GET /api/v1/policies/:id/export?format=excel|pdf|csv
```

**Parameters:**
- `id` (required, path): Policy ID
- `format` (optional, query): Export format - `excel` (default), `pdf`, `csv`

**Response:**
- Downloads a file with policy acknowledgement data
- Includes employee tracking information and acknowledgement status

**Example Formats:**

**Excel (.xlsx)**
- Sheet 1: Policy Information (title, category, status, version, dates)
- Sheet 2: Acknowledgements (employee list with status and timestamps)
- Sheet 3: Summary (acknowledgement statistics)

**PDF (.pdf)**
- Policy header with metadata
- Summary statistics (total, acknowledged, pending, percentage)
- Detailed acknowledgement table by employee

**CSV (.csv)**
- Columns: Employee ID, Name, Email, Department, Status, Acknowledged At, Version
- One employee per row

**cURL Example:**
```bash
# Export as Excel (default)
curl -X GET "http://localhost:5000/api/v1/policies/1/export" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o policy-report.xlsx

# Export as PDF
curl -X GET "http://localhost:5000/api/v1/policies/1/export?format=pdf" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o policy-report.pdf

# Export as CSV
curl -X GET "http://localhost:5000/api/v1/policies/1/export?format=csv" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o policy-report.csv
```

---

### 2. Batch Export Multiple Policies

Export acknowledgements for multiple policies in a single file.

**Endpoint:**
```
POST /api/v1/policies/export/batch
```

**Request Body:**
```json
{
  "policyIds": [1, 2, 3, 5],
  "format": "excel"
}
```

**Parameters:**
- `policyIds` (required): Array of policy IDs (max 10 policies)
- `format` (optional): `excel` (default) or `csv`

**Response:**
- Excel: One sheet per policy with acknowledgement data
- CSV: Single file with policy ID column added

**Example:**
```bash
curl -X POST "http://localhost:5000/api/v1/policies/export/batch" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "policyIds": [1, 2, 3],
    "format": "excel"
  }' \
  -o policies-batch.xlsx
```

---

## Import Endpoints

### 1. Bulk Import from CSV

Import multiple policies from a CSV file.

**Endpoint:**
```
POST /api/v1/policies/import?format=csv
```

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- File field: `file` (required) - CSV file

**Response:**
```json
{
  "imported": 5,
  "failed": 0,
  "policies": [
    {
      "id": 101,
      "title": "Code of Conduct",
      "status": "Draft",
      "category": "HR",
      "effectiveDate": "2024-01-01"
    }
  ],
  "errors": []
}
```

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/v1/policies/import?format=csv" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@policies.csv"
```

### 2. Bulk Import from JSON

Import policies using JSON payload in request body.

**Endpoint:**
```
POST /api/v1/policies/import?format=json
```

**Request Body:**
```json
[
  {
    "title": "Remote Work Policy",
    "category": "HR",
    "description": "Guidelines for remote work",
    "effectiveDate": "2024-01-01",
    "reviewDate": "2024-12-31",
    "ackRequired": true,
    "audienceConfig": {
      "type": "all",
      "departmentIds": [],
      "roleIds": [],
      "newJoinersDays": 90
    }
  },
  {
    "title": "IT Security Policy",
    "category": "IT",
    "description": "IT security standards",
    "effectiveDate": "2024-01-15",
    "reviewDate": "2024-06-15",
    "ackRequired": true,
    "audienceConfig": {
      "type": "roles",
      "roleIds": [1, 2, 3]
    }
  }
]
```

**Parameters:**
- Array of policy objects (max 100 policies per request)

**Response:**
```json
{
  "imported": 2,
  "failed": 0,
  "policies": [
    { "id": 101, "title": "Remote Work Policy", ... },
    { "id": 102, "title": "IT Security Policy", ... }
  ],
  "errors": []
}
```

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/v1/policies/import?format=json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '@policies.json'
```

---

## CSV Format Specification

### Column Definitions

| Column | Required | Type | Format | Notes |
|--------|----------|------|--------|-------|
| Title | Yes | String | Max 255 chars | Policy name/title |
| Category | Yes | String | Max 100 chars | e.g., HR, IT, Finance |
| Description | No | String | Text | Long description |
| Effective Date | No | Date | YYYY-MM-DD | When policy takes effect |
| Review Date | No | Date | YYYY-MM-DD | Next review date |
| Acknowledgement Required | No | Boolean | yes/no, true/false, 1/0 | Default: yes |
| Audience Type | No | String | all, departments, roles, new_joiners | Default: all |
| Department IDs | No | String | Comma-separated integers | Required if Audience Type = departments |
| Role IDs | No | String | Comma-separated integers | Required if Audience Type = roles |
| New Joiners Days | No | Integer | 1-365 | Default: 90 |

### Example CSV File

```csv
Title,Category,Description,Effective Date,Review Date,Acknowledgement Required,Audience Type,Department IDs,Role IDs
"Code of Conduct","HR","Company code of conduct","2024-01-01","2024-12-31","yes","all","",""
"Data Security","IT","Information security policy","2024-01-15","2024-06-15","yes","roles","","1,2,3"
"Work From Home","HR","Remote work guidelines","2024-02-01","2024-12-31","yes","departments","1,2",""
"Leave Policy","HR","Annual leave guidelines","2024-01-01","2024-12-31","yes","all","",""
"New Joiner Onboarding","HR","Onboarding requirements","2024-03-01","2024-12-31","yes","new_joiners","","",90
```

---

## Error Handling

### Validation Errors

**CSV Parse Errors:**
```json
{
  "statusCode": 400,
  "message": "CSV validation errors:\nRow 2: Title is required\nRow 3: Invalid Effective Date format (use YYYY-MM-DD)"
}
```

**Import Errors (Partial Success):**
```json
{
  "imported": 2,
  "failed": 1,
  "policies": [ { ... } ],
  "errors": [
    {
      "index": 3,
      "policy": { "title": "...", ... },
      "error": "Department IDs required when Audience Type is departments"
    }
  ]
}
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| CSV must have header row | File is empty or malformed | Include header row as first line |
| Missing required columns | Column not found in header | Add missing `Title` or `Category` column |
| Invalid Effective Date format | Wrong date format | Use YYYY-MM-DD format |
| Department IDs required | Audience Type is "departments" without IDs | Add comma-separated department IDs |
| Maximum 100 policies | Too many policies in one request | Split into multiple requests |
| No file uploaded | POST without file attachment | Include `file` in multipart form data |

---

## Examples

### Example 1: Export Single Policy to Excel

```bash
#!/bin/bash

POLICY_ID=1
TOKEN="your-jwt-token"
ENDPOINT="http://localhost:5000/api/v1/policies"

# Export as Excel
curl -X GET "$ENDPOINT/$POLICY_ID/export?format=excel" \
  -H "Authorization: Bearer $TOKEN" \
  -o "policy-${POLICY_ID}.xlsx"

echo "Exported policy $POLICY_ID to policy-${POLICY_ID}.xlsx"
```

### Example 2: Import Policies from CSV

```bash
#!/bin/bash

TOKEN="your-jwt-token"
ENDPOINT="http://localhost:5000/api/v1/policies/import"

# Import from CSV file
curl -X POST "$ENDPOINT?format=csv" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@policies.csv" \
  -o import-result.json

# Show results
cat import-result.json
```

### Example 3: Import Policies from JSON

```javascript
const fetch = require('node-fetch');

const policies = [
  {
    title: 'Remote Work Policy',
    category: 'HR',
    description: 'Work from home guidelines',
    effectiveDate: '2024-01-01',
    reviewDate: '2024-12-31',
    ackRequired: true,
    audienceConfig: {
      type: 'departments',
      departmentIds: [1, 2, 3]
    }
  },
  {
    title: 'IT Security Policy',
    category: 'IT',
    ackRequired: true,
    audienceConfig: {
      type: 'roles',
      roleIds: [1, 2]
    }
  }
];

fetch('http://localhost:5000/api/v1/policies/import?format=json', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(policies)
})
.then(res => res.json())
.then(data => {
  console.log(`Imported: ${data.imported}, Failed: ${data.failed}`);
  console.log('Policies:', data.policies);
  console.log('Errors:', data.errors);
})
.catch(err => console.error(err));
```

### Example 4: Batch Export Multiple Policies

```javascript
const fetch = require('node-fetch');

const policyIds = [1, 2, 3, 4, 5];

fetch('http://localhost:5000/api/v1/policies/export/batch', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    policyIds: policyIds,
    format: 'excel'
  })
})
.then(res => res.blob())
.then(blob => {
  // Save file
  const fs = require('fs');
  fs.writeFileSync('policies-batch.xlsx', blob);
  console.log('Exported batch report');
})
.catch(err => console.error(err));
```

---

## Permissions

All export and import endpoints require the `policies.manage` permission:

```javascript
{
  "POLICIES_MANAGE": "policies.manage",
  "POLICIES_VIEW": "policies.view",
  "POLICIES_ACKNOWLEDGE": "policies.acknowledge"
}
```

### Role-Based Access

| Role | Can Export | Can Import |
|------|-----------|-----------|
| HR Admin | ✅ | ✅ |
| Org Admin | ✅ | ✅ |
| Manager | ❌ | ❌ |
| Employee | ❌ | ❌ |

---

## Best Practices

### For Exports
1. **Schedule exports** - Export reports before policy reviews or compliance audits
2. **Archive exports** - Keep historical copies for compliance tracking
3. **Use Excel format** - Supports multiple sheets and formatting for readability
4. **Batch exports** - Export multiple policies at once to save time

### For Imports
1. **Validate CSV** - Check file format before uploading
2. **Test imports** - Import a small batch first to verify format
3. **Handle errors** - Review failed policies and correct issues
4. **Create backups** - Export current policies before bulk imports
5. **Limit batch size** - Import in batches of 50-100 policies

### Data Quality
1. **Standardize categories** - Use consistent category names
2. **Use correct date formats** - Always use YYYY-MM-DD
3. **Verify audience configuration** - Ensure department/role IDs are valid
4. **Test acknowledgement requirements** - Set ackRequired appropriately

---

## Troubleshooting

### CSV Import Fails with "Missing required columns"

**Issue:** Column names don't match expected format
**Solution:** Check header row matches specification (Title, Category, etc.)

### "Department IDs required when Audience Type is departments"

**Issue:** Audience Type set to "departments" but no IDs provided
**Solution:** Add comma-separated department IDs in Department IDs column

### "Maximum 100 policies can be imported at once"

**Issue:** Trying to import more than 100 policies
**Solution:** Split import into multiple requests (e.g., 50 policies per request)

### Export file downloads as .xlsx but opens as text

**Issue:** Browser is treating binary file as text
**Solution:** Check Content-Type header is `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

---

## Performance Notes

- **Large exports** (10k+ rows): May take 5-10 seconds, use Excel format for better performance
- **Batch imports** (100+ policies): Run asynchronously in background for better UX
- **Database load**: Audit logging recorded for all imports; plan for audit table growth

---

## Related Documentation

- [Policy Lifecycle Flow](./POLICY_LIFECYCLE.md)
- [Policy Acknowledgement Tracking](./ACKNOWLEDGEMENT_TRACKING.md)
- [Audience Configuration](./AUDIENCE_CONFIG.md)
