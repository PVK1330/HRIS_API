# Performance Cycles API Documentation

## Overview

The Performance Cycles Management API provides a complete REST interface for managing performance review cycles in the HR system. It handles creating, retrieving, updating, and deleting performance cycles with automatic status calculation based on current dates.

## Architecture

```
performanceCycles/
├── performanceCycles.controller.js    # HTTP request/response handlers
├── performanceCycles.repository.js    # Database queries
├── performanceCycles.service.js       # Business logic layer
├── performanceCycles.routes.js        # API endpoints
├── performanceCycles.validator.js     # Input validation schemas
└── README.md                          # This file
```

## Database Schema

### performance_cycles Table

```sql
CREATE TABLE performance_cycles (
  id SERIAL PRIMARY KEY,
  cycle_name VARCHAR(255) NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  submission_deadline TIMESTAMPTZ NOT NULL,
  automated_reminder BOOLEAN DEFAULT FALSE,
  status VARCHAR(50) CHECK (status IN ('ACTIVE', 'UPCOMING', 'COMPLETED')),
  completion_percentage INTEGER (0-100),
  created_by INTEGER,
  updated_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

### Indexes

- `idx_performance_cycles_status` - For status-based queries
- `idx_performance_cycles_dates` - For date range queries
- `idx_performance_cycles_name` - For search functionality
- `idx_performance_cycles_active` - For filtering active/upcoming cycles

## Status Logic

Cycle status is automatically calculated based on the current date:

- **UPCOMING**: Current date < start_date
- **ACTIVE**: start_date ≤ Current date ≤ end_date
- **COMPLETED**: Current date > end_date

Completion percentage is calculated as:
- 0% if cycle hasn't started
- 100% if cycle has ended
- (elapsed_time / total_time) × 100 while active

## API Endpoints

### 1. Get All Performance Cycles

```
GET /api/v1/performance-cycles
```

**Query Parameters:**
- `search` (optional): Search term for cycle name
- `status` (optional): Filter by status (ACTIVE, UPCOMING, COMPLETED)
- `page` (optional): Page number (default: 1)
- `limit` (optional): Records per page (default: 10, max: 100)

**Example:**
```bash
curl -X GET "http://localhost:5000/api/v1/performance-cycles?search=Q1&status=ACTIVE&page=1&limit=10" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Performance cycles retrieved successfully",
  "data": {
    "cycles": [
      {
        "id": 1,
        "cycle_name": "Q1 2026 Performance Review",
        "start_date": "2026-01-01T00:00:00.000Z",
        "end_date": "2026-03-31T23:59:59.000Z",
        "submission_deadline": "2026-04-15T23:59:59.000Z",
        "automated_reminder": true,
        "status": "ACTIVE",
        "completion_percentage": 45,
        "created_at": "2026-05-18T10:30:00.000Z",
        "updated_at": "2026-05-18T10:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

### 2. Get Single Cycle

```
GET /api/v1/performance-cycles/:id
```

**Parameters:**
- `id` (required): Cycle ID (integer)

**Response:**
```json
{
  "success": true,
  "message": "Performance cycle retrieved successfully",
  "data": {
    "id": 1,
    "cycle_name": "Q1 2026 Performance Review",
    "start_date": "2026-01-01T00:00:00.000Z",
    "end_date": "2026-03-31T23:59:59.000Z",
    "submission_deadline": "2026-04-15T23:59:59.000Z",
    "automated_reminder": true,
    "status": "ACTIVE",
    "completion_percentage": 45,
    "created_at": "2026-05-18T10:30:00.000Z",
    "updated_at": "2026-05-18T10:30:00.000Z"
  }
}
```

### 3. Create New Cycle

```
POST /api/v1/performance-cycles
```

**Request Body:**
```json
{
  "cycleName": "Q2 2026 Performance Review",
  "startDate": "2026-04-01T00:00:00.000Z",
  "endDate": "2026-06-30T23:59:59.000Z",
  "submissionDeadline": "2026-07-15T23:59:59.000Z",
  "automatedReminder": true
}
```

**Validation Rules:**
- `cycleName`: Required, 3-255 characters
- `startDate`: Required, valid ISO date
- `endDate`: Required, valid ISO date, must be after startDate
- `submissionDeadline`: Required, valid ISO date
- `automatedReminder`: Optional, boolean (default: false)

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Performance cycle created successfully",
  "data": {
    "id": 2,
    "cycle_name": "Q2 2026 Performance Review",
    "start_date": "2026-04-01T00:00:00.000Z",
    "end_date": "2026-06-30T23:59:59.000Z",
    "submission_deadline": "2026-07-15T23:59:59.000Z",
    "automated_reminder": true,
    "status": "UPCOMING",
    "completion_percentage": 0,
    "created_at": "2026-05-18T12:00:00.000Z",
    "updated_at": "2026-05-18T12:00:00.000Z"
  }
}
```

### 4. Update Cycle

```
PUT /api/v1/performance-cycles/:id
```

**Parameters:**
- `id` (required): Cycle ID

**Request Body (All fields optional):**
```json
{
  "cycleName": "Q2 2026 Performance Appraisal",
  "startDate": "2026-04-01T00:00:00.000Z",
  "endDate": "2026-06-30T23:59:59.000Z",
  "submissionDeadline": "2026-07-15T23:59:59.000Z",
  "automatedReminder": false
}
```

**Response:**
```json
{
  "success": true,
  "message": "Performance cycle updated successfully",
  "data": {
    "id": 2,
    "cycle_name": "Q2 2026 Performance Appraisal",
    "status": "UPDATED",
    "completion_percentage": 0
  }
}
```

**Note:** Status and completion percentage are automatically recalculated when dates are updated.

### 5. Delete Cycle

```
DELETE /api/v1/performance-cycles/:id
```

**Parameters:**
- `id` (required): Cycle ID

**Response:**
```json
{
  "success": true,
  "message": "Performance cycle deleted successfully",
  "data": {
    "id": 2,
    "cycle_name": "Q2 2026 Performance Review",
    "deleted_at": "2026-05-18T13:00:00.000Z"
  }
}
```

**Note:** This is a soft delete. The record is marked with `deleted_at` but not physically removed.

### 6. Get Cycles Summary

```
GET /api/v1/performance-cycles/summary
```

**Response:**
```json
{
  "success": true,
  "message": "Performance cycles summary retrieved successfully",
  "data": {
    "activeCycles": 3,
    "upcomingCycles": 2,
    "completedCycles": 1
  }
}
```

## Permissions

All endpoints require authentication and the following permissions:

- **View endpoints** (GET): `PERFORMANCE_VIEW` permission
- **Write endpoints** (POST, PUT, DELETE): `PERFORMANCE_MANAGE` permission

## Error Handling

All errors follow a consistent format:

```json
{
  "success": false,
  "message": "Error description",
  "statusCode": 400
}
```

### Common Error Codes

- `400 Bad Request`: Validation error
- `401 Unauthorized`: Missing or invalid authentication token
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Cycle not found
- `500 Internal Server Error`: Server error

## Frontend Integration

### Installation

The frontend API service is located at:
```
HRIS/src/services/performanceCyclesAPI.js
```

### Usage Example

```javascript
import performanceCyclesAPI from '@/services/performanceCyclesAPI'

// Get all cycles
const { data } = await performanceCyclesAPI.getAllCycles({
  search: 'Q1',
  status: 'ACTIVE',
  page: 1,
  limit: 10
})

// Create new cycle
const { data: newCycle } = await performanceCyclesAPI.createCycle({
  cycleName: 'Q3 2026 Performance Review',
  startDate: '2026-07-01T00:00:00Z',
  endDate: '2026-09-30T23:59:59Z',
  submissionDeadline: '2026-10-15T23:59:59Z',
  automatedReminder: true
})

// Update cycle
const { data: updated } = await performanceCyclesAPI.updateCycle(1, {
  cycleName: 'Updated Name',
  automatedReminder: false
})

// Delete cycle
await performanceCyclesAPI.deleteCycle(1)

// Get summary
const { data: summary } = await performanceCyclesAPI.getSummary()
console.log(summary.activeCycles) // 3
```

## Performance Considerations

1. **Indexes**: Database queries use optimized indexes for fast lookups
2. **Pagination**: Large result sets are paginated (max 100 per page)
3. **Soft Deletes**: Deleted records aren't removed, only marked as deleted
4. **Status Caching**: Status is recalculated on every update; consider running a periodic background job to refresh statuses

## Background Job for Status Refresh

A cron job can be set up to periodically refresh all cycle statuses:

```javascript
const cron = require('node-cron');
const performanceCyclesService = require('./modules/performanceCycles/performanceCycles.service');

// Run every hour
cron.schedule('0 * * * *', async () => {
  try {
    const adminUser = { id: 1, db_name: 'tenant_db' }; // System user
    await performanceCyclesService.refreshCycleStatuses(adminUser);
    console.log('Performance cycle statuses refreshed');
  } catch (error) {
    console.error('Error refreshing statuses:', error);
  }
});
```

## Testing

### Using Postman

1. Import the Postman collection: `Performance_Cycles_API.postman_collection.json`
2. Set the `baseUrl` and `token` variables
3. Run the requests

### Using cURL

```bash
# Get all cycles
curl -X GET "http://localhost:5000/api/v1/performance-cycles" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Create new cycle
curl -X POST "http://localhost:5000/api/v1/performance-cycles" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cycleName": "Q2 2026 Review",
    "startDate": "2026-04-01T00:00:00.000Z",
    "endDate": "2026-06-30T23:59:59.000Z",
    "submissionDeadline": "2026-07-15T23:59:59.000Z",
    "automatedReminder": true
  }'
```

## Migration

To apply the database migration:

```bash
# In HRIS_API directory
npm run migrate

# Or for specific tenant
npm run migrate:tenants
```

## Additional Resources

- [HRIS Backend Documentation](../README.md)
- [Database Schema](../migrations/tenants/019_create_performance_cycles_table.sql)
- [Postman Collection](./Performance_Cycles_API.postman_collection.json)
