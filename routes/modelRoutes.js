const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Collection = require('../models/modelModel');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');

// Helper: Format file data
const formatFile = (file) => ({
  key: file.key,
  url: getS3Url(file.key),
  originalName: file.originalname,
  mimeType: file.mimetype,
  size: file.size
});

// Helper: Cleanup uploaded files
const cleanup = async (files) => {
  if (files?.icon) await deleteFromS3(files.icon[0].key).catch(() => {});
};

// ============= CREATE =============
router.post('/', authenticateToken, authorizeAdmin, upload.single('icon'), async (req, res) => {
  try {
    const { name, isActive = true } = req.body;
    
    if (!name) {
      if (req.file) await deleteFromS3(req.file.key);
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    // Check duplicate name
    const existing = await Collection.findOne({ name: name });
    if (existing) {
      if (req.file) await deleteFromS3(req.file.key);
      return res.status(400).json({ success: false, message: 'Model name already exists' });
    }

    const data = {
      name,
      isActive: isActive === 'true' || isActive === true,
      icon: req.file ? formatFile(req.file) : null
    };

    const collection = await Collection.create(data);
    res.status(201).json({ success: true, message: 'Model created', data: collection });
  } catch (error) {
    if (req.file) await deleteFromS3(req.file.key);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============= GET ALL (with pagination) =============
router.get('/', async (req, res) => {
  try {
    const { isActive, search, page = 1, limit = 10 } = req.query;
    
    const query = {};
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (search) query.name = { $regex: search, $options: 'i' };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [data, total] = await Promise.all([
      Collection.find(query).sort('-createdAt').skip(skip).limit(parseInt(limit)),
      Collection.countDocuments(query)
    ]);

    res.json({
      success: true,
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============= GET ONE =============
router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    
    const collection = await Collection.findById(req.params.id);
    if (!collection) return res.status(404).json({ success: false, message: 'Not found' });
    
    res.json({ success: true, data: collection });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============= UPDATE =============
router.put('/:id', authenticateToken, authorizeAdmin, upload.single('icon'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      if (req.file) await deleteFromS3(req.file.key);
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }

    const collection = await Collection.findById(id);
    if (!collection) {
      if (req.file) await deleteFromS3(req.file.key);
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    // Check name duplicate if changed
    if (name && name.toLowerCase() !== collection.name.toLowerCase()) {
      const existing = await Collection.findOne({ 
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        _id: { $ne: id }
      });
      if (existing) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({ success: false, message: 'Name already exists' });
      }
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (isActive !== undefined) updateData.isActive = isActive === 'true' || isActive === true;

    // Handle icon update
    if (req.file) {
      if (collection.icon?.key) await deleteFromS3(collection.icon.key).catch(() => {});
      updateData.icon = formatFile(req.file);
    }

    const updated = await Collection.findByIdAndUpdate(id, updateData, { new: true });
    res.json({ success: true, message: 'Model updated', data: updated });
  } catch (error) {
    if (req.file) await deleteFromS3(req.file.key);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============= DELETE =============
router.delete('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }

    const collection = await Collection.findById(id);
    if (!collection) return res.status(404).json({ success: false, message: 'Not found' });

    // Delete icon from S3
    if (collection.icon?.key) {
      await deleteFromS3(collection.icon.key).catch(() => {});
    }

    await Collection.findByIdAndDelete(id);
    res.json({ success: true, message: 'Model deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============= TOGGLE STATUS =============
router.patch('/:id/toggle', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }

    const collection = await Collection.findById(id);
    if (!collection) return res.status(404).json({ success: false, message: 'Not found' });

    collection.isActive = !collection.isActive;
    await collection.save();

    res.json({ 
      success: true, 
      message: `Collection ${collection.isActive ? 'activated' : 'deactivated'}`,
      data: { isActive: collection.isActive }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;