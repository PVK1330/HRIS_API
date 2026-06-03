const notify = require('../attendanceNotifications.service');
const { pushNotification, sendSystemNotification } = require('../../../notifications/notifications.service');

jest.mock('../../../notifications/notifications.service');

describe('Attendance Notifications', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = {
      query: jest.fn()
    };
    jest.clearAllMocks();
  });

  const tenantDb = 'test_tenant';

  describe('Deduplication', () => {
    it('should skip duplicate notifications using attendance_notification_history', async () => {
      mockPool.query.mockRejectedValueOnce({ code: '23505' }); // Simulate unique violation
      await notify.notifyCheckIn(mockPool, tenantDb, {
        employeeId: 1, employeeName: 'John', time: '09:00', date: '2023-10-10', entityId: 100
      });
      expect(sendSystemNotification).not.toHaveBeenCalled();
    });
  });

  describe('Events', () => {
    beforeEach(() => {
      // Mock history insertion to succeed
      mockPool.query.mockImplementation((queryStr) => {
        if (queryStr.includes('attendance_notification_history')) {
          return Promise.resolve({ rowCount: 1 });
        }
        if (queryStr.includes('getEmployeeDetails')) {
          return Promise.resolve({ rows: [{ manager_id: 2, name: 'John Doe' }] });
        }
        if (queryStr.includes('notification_templates')) {
          return Promise.resolve({ rows: [] });
        }
        if (queryStr.includes('reporting_manager_id')) {
          return Promise.resolve({ rows: [{ manager_id: 2, name: 'John Doe' }] });
        }
        if (queryStr.includes('role IN')) {
          return Promise.resolve({ rows: [{ id: 3 }] }); // HR Admin
        }
        return Promise.resolve({ rows: [] });
      });
    });

    it('should notify Check In for employee and manager', async () => {
      await notify.notifyCheckIn(mockPool, tenantDb, { employeeId: 1, time: '09:00', date: '2023-10-10', entityId: 100 });
      expect(sendSystemNotification).toHaveBeenCalledTimes(2); // Employee + Manager
    });

    it('should notify Check Out for employee only', async () => {
      await notify.notifyCheckOut(mockPool, tenantDb, { employeeId: 1, time: '17:00', date: '2023-10-10', entityId: 100 });
      expect(sendSystemNotification).toHaveBeenCalledTimes(1);
    });

    it('should notify Late Arrival for employee and manager', async () => {
      await notify.notifyLateArrival(mockPool, tenantDb, { employeeId: 1, time: '10:00', date: '2023-10-10', entityId: 100 });
      expect(sendSystemNotification).toHaveBeenCalledTimes(2);
    });

    it('should notify Missing Checkout for employee and manager', async () => {
      await notify.notifyMissingCheckout(mockPool, tenantDb, { employeeId: 1, date: '2023-10-10', entityId: 100 });
      expect(sendSystemNotification).toHaveBeenCalledTimes(2);
    });

    it('should notify Regularization Submitted for approver', async () => {
      await notify.notifyRegSubmitted(mockPool, tenantDb, { employeeId: 1, date: '2023-10-10', entityId: 100 });
      expect(sendSystemNotification).toHaveBeenCalledTimes(1); // Approver
    });

    it('should notify Regularization Approved for employee', async () => {
      await notify.notifyRegApproved(mockPool, tenantDb, { employeeId: 1, date: '2023-10-10', entityId: 100 });
      expect(sendSystemNotification).toHaveBeenCalledTimes(1); // Employee
    });

    it('should notify Regularization Rejected for employee', async () => {
      await notify.notifyRegRejected(mockPool, tenantDb, { employeeId: 1, date: '2023-10-10', entityId: 100, reason: 'N/A' });
      expect(sendSystemNotification).toHaveBeenCalledTimes(1); // Employee
    });

    it('should notify Regularization Auto Rejected for employee and HR', async () => {
      await notify.notifyRegAutoRejected(mockPool, tenantDb, { employeeId: 1, date: '2023-10-10', entityId: 100 });
      expect(sendSystemNotification).toHaveBeenCalledTimes(2); // Employee + HR Admin
    });

    it('should notify Override for employee and HR', async () => {
      await notify.notifyOverride(mockPool, tenantDb, { employeeId: 1, date: '2023-10-10', entityId: 100, overriderName: 'Admin' });
      expect(sendSystemNotification).toHaveBeenCalledTimes(2); // Employee + HR
    });

    it('should notify Absent for employee and manager', async () => {
      await notify.notifyAbsent(mockPool, tenantDb, { employeeId: 1, date: '2023-10-10' });
      expect(sendSystemNotification).toHaveBeenCalledTimes(2); // Employee + Manager
    });

    it('should notify Overtime Approved for employee', async () => {
      await notify.notifyOtApproved(mockPool, tenantDb, { employeeId: 1, date: '2023-10-10', entityId: 100, hours: 2 });
      expect(sendSystemNotification).toHaveBeenCalledTimes(1);
    });
  });
});
