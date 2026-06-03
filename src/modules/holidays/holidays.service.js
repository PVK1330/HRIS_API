'use strict';

const path = require('path');
const fs = require('fs');
const { getTenantPool } = require('../../config/db');
const ApiError = require('../../utils/ApiError');
const repo = require('./holidays.repository');
const holidayNotify = require('./holidayNotifications.service');
const audit = require('../employees/attendance/attendanceAudit.service');

const SEED_PATH = path.join(__dirname, '../../data/uk-bank-holidays.json');

function loadSeedData() {
  const raw = fs.readFileSync(SEED_PATH, 'utf8');
  return JSON.parse(raw);
}

async function seedFromConfig(pool, { year, regions } = {}) {
  const config = loadSeedData();
  const targetYear = year || new Date().getFullYear();
  const yearData = config.years[String(targetYear)];
  if (!yearData) {
    throw ApiError.badRequest(`No holiday seed data configured for year ${targetYear}`);
  }

  const targetRegions = regions?.length
    ? regions.filter((r) => config.regions.includes(r))
    : config.regions;

  const results = [];
  for (const region of targetRegions) {
    const holidays = yearData[region] || [];
    const cal = await repo.upsertCalendar(pool, {
      name: `${region} ${targetYear}`,
      region,
      year: targetYear,
      isActive: true,
    });
    for (const h of holidays) {
      await repo.addDate(pool, cal.id, h.date, h.name);
    }
    results.push({ region, year: targetYear, count: holidays.length, calendarId: cal.id });
  }
  return { year: targetYear, seeded: results };
}

async function listCalendars(dbName, query) {
  const pool = getTenantPool(dbName);
  return repo.listCalendars(pool, query);
}

async function getCalendarDetail(dbName, calendarId) {
  const pool = getTenantPool(dbName);
  const cal = await repo.getCalendarById(pool, calendarId);
  if (!cal) throw ApiError.notFound('Holiday calendar not found');
  const dates = await repo.listDates(pool, calendarId);
  return { ...cal, dates };
}

async function createHolidayDate(dbName, tenantDb, { calendarId, holidayDate, name }, req) {
  const pool = getTenantPool(dbName);
  const cal = await repo.getCalendarById(pool, calendarId);
  if (!cal) throw ApiError.notFound('Holiday calendar not found');
  const row = await repo.addDate(pool, calendarId, holidayDate, name);
  await holidayNotify.notifyHolidayEvent(pool, tenantDb, {
    eventType: holidayNotify.EVENT_TYPES.CREATED,
    title: 'Holiday added',
    message: `${name} on ${holidayDate} (${cal.region}) has been added to the calendar.`,
    entityId: row.id,
  });
  await audit.log(pool, {
    action: 'holiday.created',
    newValue: row,
    performedBy: req?.user?.employeeId || req?.auth?.employeeId,
    ...audit.auditMeta(req),
  });
  return row;
}

async function updateHolidayDate(dbName, tenantDb, id, patch, req) {
  const pool = getTenantPool(dbName);
  const old = await pool.query(`SELECT * FROM holiday_dates WHERE id = $1`, [id]);
  const row = await repo.updateDate(pool, id, patch);
  if (!row) throw ApiError.notFound('Holiday date not found');
  await holidayNotify.notifyHolidayEvent(pool, tenantDb, {
    eventType: holidayNotify.EVENT_TYPES.UPDATED,
    title: 'Holiday updated',
    message: `Holiday on ${row.holiday_date} was updated to "${row.name}".`,
    entityId: row.id,
  });
  await audit.log(pool, {
    action: 'holiday.updated',
    oldValue: old.rows[0],
    newValue: row,
    performedBy: req?.user?.employeeId || req?.auth?.employeeId,
    ...audit.auditMeta(req),
  });
  return row;
}

async function deleteHolidayDate(dbName, tenantDb, id, req) {
  const pool = getTenantPool(dbName);
  const old = await repo.deleteDate(pool, id);
  if (!old) throw ApiError.notFound('Holiday date not found');
  await holidayNotify.notifyHolidayEvent(pool, tenantDb, {
    eventType: holidayNotify.EVENT_TYPES.DELETED,
    title: 'Holiday removed',
    message: `A holiday entry was removed from the calendar.`,
    entityId: id,
  });
  await audit.log(pool, {
    action: 'holiday.deleted',
    oldValue: old,
    performedBy: req?.user?.employeeId || req?.auth?.employeeId,
    ...audit.auditMeta(req),
  });
  return { deleted: true };
}

async function sendUpcomingReminders(pool, tenantDb, withinDays = 7) {
  const { rows } = await pool.query(
    `SELECT hd.id, hd.name,
            TO_CHAR(hd.holiday_date, 'YYYY-MM-DD') AS holiday_date,
            hc.region
     FROM holiday_dates hd
     JOIN holiday_calendars hc ON hc.id = hd.calendar_id
     WHERE hc.is_active = true
       AND hd.holiday_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + $1::int)`,
    [withinDays],
  );
  for (const h of rows) {
    await holidayNotify.notifyHolidayEvent(pool, tenantDb, {
      eventType: holidayNotify.EVENT_TYPES.REMINDER,
      title: 'Upcoming public holiday',
      message: `Reminder: ${h.name} on ${h.holiday_date} (${h.region}).`,
      entityId: h.id,
    });
  }
  return { reminded: rows.length };
}

module.exports = {
  UK_REGIONS: repo.UK_REGIONS,
  seedFromConfig,
  listCalendars,
  getCalendarDetail,
  createHolidayDate,
  updateHolidayDate,
  deleteHolidayDate,
  sendUpcomingReminders,
};
