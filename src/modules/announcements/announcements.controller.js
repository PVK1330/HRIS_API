'use strict';

const { getTenantPool } = require('../../config/db');
const repo = require('./announcements.repository');
const service = require('./announcements.service');

function getPool(req) {
  return req.tenant?.pool || getTenantPool(req.tenant?.dbName || req.user?.db_name);
}

function getTenant(req) {
  return {
    dbName: req.tenant?.dbName || req.user?.db_name,
    adminEmail: req.tenant?.adminEmail,
    id: req.tenant?.id || req.user?.tenant_id,
  };
}

exports.getAll = async (req, res) => {
  try {
    const pool = getPool(req);
    const announcements = await service.listAnnouncements(pool, req.user);
    res.status(200).json({ success: true, data: announcements });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getStats = async (req, res) => {
  try {
    const pool = getPool(req);
    const isAdmin = ['admin', 'hr_admin', 'hr_executive', 'manager'].includes(req.user?.role);
    if (!isAdmin) {
      const published = await service.listAnnouncements(pool, req.user);
      return res.status(200).json({
        success: true,
        data: {
          total: published.length,
          published: published.length,
          drafts: 0,
          scheduled: 0,
        },
      });
    }
    const stats = await repo.getStats(pool);
    res.status(200).json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const pool = getPool(req);
    const tenant = getTenant(req);
    const announcement = await service.createAnnouncement(tenant, pool, req.user, req.body);
    res.status(201).json({ success: true, data: announcement });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const pool = getPool(req);
    const tenant = getTenant(req);
    const announcement = await service.updateAnnouncement(tenant, pool, req.user, req.params.id, req.body);
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }
    res.status(200).json({ success: true, data: announcement });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const pool = getPool(req);
    await repo.remove(pool, req.params.id);
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
