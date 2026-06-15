# Policy Management Module

Complete policy lifecycle management with export/import functionality.

## Quick Start

### 📁 Module Files

```
src/modules/policies/
├── policies.routes.js         # API endpoints
├── policies.controller.js      # Request handlers
├── policies.service.js         # Business logic
├── policies.repository.js      # Database access
├── policies.employee.js        # Employee audience logic
├── policies.audience.js        # Audience configuration
├── policies.normalize.js       # Data normalization
├── policies.export.js          # NEW: Export to Excel/PDF/CSV
├── policies.import.js          # NEW: Import from CSV/JSON
├── EXPORT_IMPORT_DOCS.md       # NEW: Complete API docs
├── IMPORT_TEMPLATE.csv         # NEW: CSV template example
├── IMPLEMENTATION_SUMMARY.md   # NEW: Implementation details
└── README.md                   # This file
```

---

## 🎯 API Endpoints

### List & CRUD

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-----------|
| GET | `/policies` | List all policies | policies.manage |
| POST | `/policies` | Create policy | policies.manage |
| GET | `/policies/:id` | Get single policy | policies.manage |
| PATCH | `/policies/:id` | Update policy | policies.manage |
| DELETE | `/policies/:id` | Delete (archive) policy | policies.manage |

### Acknowledgements

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-----------|
| GET | `/policies/:id/tracking` | Get acknowledgement tracking | policies.manage |
| POST | `/policies/:id/acknowledge` | Acknowledge policy | policies.acknowledge |
| GET | `/policies/me` | Get my policies | policies.view |
| POST | `/policies/me/:id` | Acknowledge my policy | policies.acknowledge |

### Categories

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-----------|
| GET | `/policies/categories` | List categories | policies.manage |
| POST | `/policies/categories` | Create category | policies.manage |
| PATCH | `/policies/categories/:id` | Update category | policies.manage |
| DELETE | `/policies/categories/:id` | Delete category | policies.manage |

### **NEW: Export & Import**

| Method | Endpoint | Description | Permission |
|--------|----------|-------------|-----------|
| GET | `/policies/:id/export?format=excel\|pdf\|csv` | Export single policy | policies.manage |
| POST | `/policies/export/batch` | Batch export multiple | policies.manage |
| POST | `/policies/import?format=csv\|json` | Import policies | policies.manage |

---

## 🚀 Export Features

### Single Policy Export
```bash
# Excel (default)
GET /policies/1/export

# PDF
GET /policies/1/export?format=pdf

# CSV
GET /policies/1/export?format=csv
```

**Includes:**
- Policy metadata (title, category, status, version)
- Employee acknowledgement tracking
- Summary statistics
- Professional formatting

### Batch Export
```bash
POST /policies/export/batch
{
  "policyIds": [1, 2, 3],
  "format": "excel"
}
```

**Response:**
- Excel: One sheet per policy
- CSV: All in single file with policy ID column

---

## 📥 Import Features

### CSV Import
```bash
POST /policies/import?format=csv
(multipart: file=policies.csv)
```

**Supported Columns:**
```
Title, Category, Description, Effective Date, Review Date,
Acknowledgement Required, Audience Type, Department IDs, Role IDs
```

**Example:**
```csv
Title,Category,Description,Effective Date,Review Date,Acknowledgement Required,Audience Type,Department IDs,Role IDs
"Code of Conduct","HR","Company conduct policy","2024-01-01","2024-12-31","yes","all","",""
"Data Security","IT","IT security standards","2024-01-15","2024-06-15","yes","roles","","1,2,3"
```

### JSON Import
```bash
POST /policies/import?format=json
[
  {
    "title": "Remote Work Policy",
    "category": "HR",
    "ackRequired": true,
    "audienceConfig": {
      "type": "departments",
      "departmentIds": [1, 2]
    }
  }
]
```

---

## 📊 Data Models

### Policy Object
```javascript
{
  id: 1,
  title: "Code of Conduct",
  category: "HR",
  description: "...",
  status: "Published",           // Draft, Published, Archived
  effectiveDate: "2024-01-01",
  reviewDate: "2024-12-31",
  ackRequired: true,
  contentVersion: 1,
  contentHash: "abc123...",
  publishedAt: "2024-01-01T10:00:00Z",
  audienceConfig: {
    type: "all",                  // all, departments, roles, new_joiners
    departmentIds: [],
    roleIds: [],
    newJoinersDays: 90
  },
  attachments: [],
  fileUrl: null,
  createdBy: 1,
  createdAt: "2024-01-01T...",
  updatedAt: "2024-01-01T..."
}
```

### Acknowledgement Object
```javascript
{
  id: 1,
  policyId: 1,
  employeeId: 1,
  status: "Acknowledged",        // Acknowledged, Pending, Not Applicable
  acknowledgedAt: "2024-01-02T14:30:00Z",
  acknowledgedVersion: 1,
  ipAddress: "192.168.1.1"
}
```

---

## 🎨 Export Formats

### Excel (.xlsx)
- **Sheet 1:** Policy Info
  - Policy metadata in key-value format
  - Status, version, dates highlighted
  
- **Sheet 2:** Acknowledgements
  - Employee list with tracking data
  - Status color-coded (Green=Acknowledged, Amber=Pending)
  - Alternating row colors for readability

- **Sheet 3:** Summary
  - Total employees
  - Acknowledged count
  - Pending count
  - Acknowledgement percentage

### PDF
- Professional header with policy title
- Policy information section
- Summary statistics
- Tabular acknowledgement data
- Multi-page support for large datasets

### CSV
- Standard comma-separated format
- Headers: Employee ID, Name, Email, Department, Status, Ack Date, Version
- Proper escaping for special characters

---

## ✅ Validation Rules

### Import Validation

| Field | Required | Rules |
|-------|----------|-------|
| Title | Yes | Max 255 chars |
| Category | Yes | Max 100 chars |
| Description | No | Text field |
| Effective Date | No | Format: YYYY-MM-DD |
| Review Date | No | Format: YYYY-MM-DD |
| Ack Required | No | Boolean (yes/no/true/false/1/0) |
| Audience Type | No | Must be: all, departments, roles, new_joiners |
| Department IDs | Conditional | Required if type=departments |
| Role IDs | Conditional | Required if type=roles |

### Error Handling

- **CSV Parse Errors:** Line-by-line error reporting
- **Validation Errors:** Field-specific error messages
- **Partial Import:** Returns both successes and failures
- **Max Limits:** 100 policies per import, 10 policies per batch export

---

## 🔐 Permissions

**Required:** `policies.manage`

```javascript
const P = {
  POLICIES_MANAGE: 'policies.manage',
  POLICIES_VIEW: 'policies.view',
  POLICIES_ACKNOWLEDGE: 'policies.acknowledge'
};
```

### Role Access

| Action | Admin | Manager | Employee |
|--------|-------|---------|----------|
| Create Policy | ✅ | ❌ | ❌ |
| Publish Policy | ✅ | ❌ | ❌ |
| Export Policy | ✅ | ❌ | ❌ |
| Import Policies | ✅ | ❌ | ❌ |
| View My Policies | ✅ | ✅ | ✅ |
| Acknowledge Policy | ✅ | ✅ | ✅ |

---

## 📋 Audience Configuration

### Type: All Employees
```javascript
{
  type: "all",
  departmentIds: [],
  roleIds: [],
  newJoinersDays: 90
}
```

### Type: Specific Departments
```javascript
{
  type: "departments",
  departmentIds: [1, 2, 3],      // Required
  roleIds: [],
  newJoinersDays: 90
}
```

### Type: Specific Roles
```javascript
{
  type: "roles",
  departmentIds: [],
  roleIds: [1, 2, 3],             // Required
  newJoinersDays: 90
}
```

### Type: New Joiners Only
```javascript
{
  type: "new_joiners",
  departmentIds: [],
  roleIds: [],
  newJoinersDays: 90             // Joined within last X days
}
```

---

## 🔄 Policy Lifecycle

```
Draft → Publish → Notify Audience → Acknowledge → Complete
                        ↓
                   New Version?
                        ↓
                   Re-acknowledge
```

**Status Transitions:**
- `Draft` → `Published` (ready for audience)
- `Published` → `Archived` (soft-delete, keeps history)
- Any version bump invalidates prior acknowledgements

**Version Tracking:**
- `content_hash` detects material changes
- `content_version` increments on changes
- Employees must re-acknowledge new versions

---

## 🚨 Audit Logging

All operations logged to `workflow_audit_logs`:

```javascript
{
  module: 'policies',
  action: 'create|update|publish|acknowledge|archive|import|reminder|review_reminder',
  entityType: 'policy',
  entityId: 1,
  actorEmployeeId: 1,
  actorName: 'John Doe',
  detail: { ... }
}
```

---

## 💡 Examples

### Export Single Policy to Excel
```javascript
const response = await fetch('/api/v1/policies/1/export?format=excel', {
  headers: { 'Authorization': 'Bearer TOKEN' }
});
const blob = await response.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'policy-1.xlsx';
a.click();
```

### Import Policies from CSV
```javascript
const formData = new FormData();
formData.append('file', csvFile);

const response = await fetch('/api/v1/policies/import?format=csv', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer TOKEN' },
  body: formData
});
const result = await response.json();
console.log(`Imported: ${result.imported}, Failed: ${result.failed}`);
```

### Batch Export Multiple Policies
```javascript
const response = await fetch('/api/v1/policies/export/batch', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    policyIds: [1, 2, 3],
    format: 'excel'
  })
});
```

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| [EXPORT_IMPORT_DOCS.md](./EXPORT_IMPORT_DOCS.md) | Complete API documentation with curl examples |
| [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) | Technical implementation details |
| [IMPORT_TEMPLATE.csv](./IMPORT_TEMPLATE.csv) | Sample CSV for reference |

---

## ⚙️ Configuration

### Environment Variables

```bash
# Optional: Customize reminder timing
POLICY_ACK_REMINDER_THRESHOLD_DAYS=3      # Days pending before first reminder
POLICY_ACK_REMINDER_CADENCE_DAYS=3        # Min days between reminders
POLICY_REVIEW_REMINDER_LEAD_DAYS=7        # Days before review date to notify
DISABLE_POLICY_ACK_REMINDER_CRON=false    # Disable reminder cron job
```

### Cron Schedule
- **Daily at 10:00 AM** (configurable via TZ env)
- Sends acknowledgement reminders
- Sends review-due reminders

---

## 🐛 Troubleshooting

### Common Issues

**"CSV validation errors: Missing required columns"**
- Check CSV has `Title` and `Category` columns
- Header row must match expected column names

**"Department IDs required when Audience Type is departments"**
- Add department IDs to the Department IDs column
- Format: comma-separated (e.g., `1,2,3`)

**"Maximum 100 policies" on import**
- Split import into multiple batches
- Each request: max 100 policies

**"Maximum 10 policies" on batch export**
- Export in smaller batches (1-10 at a time)

---

## 📈 Performance Tips

- **CSV** is fastest for exports (best for >5000 rows)
- **Excel** is most readable (best for <2000 rows)
- **PDF** is for printing (best for compliance reports)
- Import in batches of 50-100 for optimal performance
- Batch exports work well up to 10 policies

---

## 🔒 Security

✅ Permission-based access control  
✅ Tenant isolation enforced  
✅ Input validation on all fields  
✅ SQL injection protected  
✅ Audit trail for compliance  
✅ File upload scanning ready  

---

## 📞 Support

For issues or questions:
1. Check [EXPORT_IMPORT_DOCS.md](./EXPORT_IMPORT_DOCS.md) for API details
2. Review [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for technical info
3. Check error messages in response body
4. Review audit logs in `workflow_audit_logs` table

---

**Status:** ✅ Production Ready  
**Last Updated:** 2024-06-13  
**Version:** 1.0.0
