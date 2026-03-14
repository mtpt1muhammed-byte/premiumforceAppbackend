const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Terminal = require('../models/terminal_model');
const Airport = require('../models/airportsModel');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');





// ============= GET TERMINALS BY AIRPORT ID =============
// GET /api/terminals/airport/:airportId - Get terminals for a specific airport
router.get('/terminals/:airportId', async (req, res) => {
  try {
    const { airportId } = req.params;
    const { isActive, page = 1, limit = 100, sortBy = 'terminalName', sortOrder = 'asc' } = req.query;

    // Validate airport ID
    if (!mongoose.Types.ObjectId.isValid(airportId)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid airport ID format' 
      });
    }

    // Check if airport exists
    const airport = await Airport.findById(airportId).select('airportName airportCode cityID');
    if (!airport) {
      return res.status(404).json({ 
        success: false, 
        message: 'Airport not found' 
      });
    }

    // Build query
    const query = { airportID: airportId };
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 100;
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Get terminals
    const terminals = await Terminal.find(query)
      .populate({
        path: 'airportID',
        populate: { path: 'cityID', select: 'cityName' }
      })
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    const total = await Terminal.countDocuments(query);

    // Format response
    res.json({
      success: true,
      airport: {
        _id: airport._id,
        name: airport.airportName,
        code: airport.airportCode,
        city: airport.cityID
      },
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < Math.ceil(total / limitNum),
        hasPrevPage: pageNum > 1
      },
      count: terminals.length,
      data: terminals
    });

  } catch (error) {
    console.error('Get terminals by airport error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching terminals',
      error: error.message 
    });
  }
});












// ============= CREATE TERMINAL =============
router.post('/', 
  authenticateToken, authorizeAdmin,
  upload.single('image'), 
  async (req, res) => {
    try {
      const { airportID, terminalName, isActive } = req.body;

      // Validation
      if (!airportID || !terminalName) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({ 
          success: false, 
          message: 'Airport ID and terminal name are required' 
        });
      }

      if (!mongoose.Types.ObjectId.isValid(airportID)) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({ success: false, message: 'Invalid airport ID' });
      }

      // Check if airport exists
      const airportExists = await Airport.findById(airportID);
      if (!airportExists) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(404).json({ success: false, message: 'Airport not found' });
      }

      // Check if terminal exists in this airport
      const existing = await Terminal.findOne({
        airportID,
        terminalName: { $regex: new RegExp(`^${terminalName}$`, 'i') }
      });

      if (existing) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({ 
          success: false, 
          message: 'Terminal with this name already exists in this airport' 
        });
      }

      // Create terminal
      const terminalData = {
        airportID,
        terminalName: String(terminalName).trim(),
        isActive: isActive === 'true' || isActive === true || isActive === undefined
      };

      if (req.file) {
        terminalData.image = {
          key: req.file.key,
          url: getS3Url(req.file.key),
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        };
      }

      const terminal = new Terminal(terminalData);
      await terminal.save();
      await terminal.populate('airportID', 'airportName cityID');

      res.status(201).json({ success: true, message: 'Terminal created', data: terminal });
      
    } catch (error) {
      if (req.file) await deleteFromS3(req.file.key).catch(console.error);
      res.status(500).json({ success: false, message: error.message });
    }
});

// ============= GET ALL TERMINALS with Pagination =============
router.get('/', async (req, res) => {
  try {
    const { 
      airportID, search, isActive,
      page = 1, limit = 10,
      sortBy = 'createdAt', sortOrder = 'desc'
    } = req.query;

    const query = {};
    if (airportID) {
      if (!mongoose.Types.ObjectId.isValid(airportID)) {
        return res.status(400).json({ success: false, message: 'Invalid airport ID' });
      }
      query.airportID = airportID;
    }
    if (search) query.terminalName = { $regex: search, $options: 'i' };
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const terminals = await Terminal.find(query)
      .populate({
        path: 'airportID',
        populate: { path: 'cityID', select: 'cityName' }
      })
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    const total = await Terminal.countDocuments(query);

    res.json({
      success: true,
      data: terminals,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        hasNextPage: pageNum < Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============= GET TERMINAL BY ID =============
router.get('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }

    const terminal = await Terminal.findById(id).populate({
      path: 'airportID',
      populate: { path: 'cityID', select: 'cityName' }
    });

    if (!terminal) {
      return res.status(404).json({ success: false, message: 'Terminal not found' });
    }

    res.json({ success: true, data: terminal });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============= UPDATE TERMINAL =============
router.put('/:id', 
  authenticateToken, authorizeAdmin,
  upload.single('image'), 
  async (req, res) => {
    try {
      const { id } = req.params;
      const { airportID, terminalName, isActive } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({ success: false, message: 'Invalid ID' });
      }

      const existing = await Terminal.findById(id);
      if (!existing) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(404).json({ success: false, message: 'Terminal not found' });
      }

      // Check airport if provided
      if (airportID) {
        if (!mongoose.Types.ObjectId.isValid(airportID)) {
          if (req.file) await deleteFromS3(req.file.key);
          return res.status(400).json({ success: false, message: 'Invalid airport ID' });
        }
        const airportExists = await Airport.findById(airportID);
        if (!airportExists) {
          if (req.file) await deleteFromS3(req.file.key);
          return res.status(404).json({ success: false, message: 'Airport not found' });
        }
      }

      // Check duplicate name
      if (terminalName) {
        const duplicate = await Terminal.findOne({
          _id: { $ne: id },
          airportID: airportID || existing.airportID,
          terminalName: { $regex: new RegExp(`^${terminalName}$`, 'i') }
        });
        if (duplicate) {
          if (req.file) await deleteFromS3(req.file.key);
          return res.status(400).json({ 
            success: false, 
            message: 'Terminal name already exists in this airport' 
          });
        }
      }

      // Update data
      const updateData = {
        airportID: airportID || existing.airportID,
        terminalName: terminalName ? String(terminalName).trim() : existing.terminalName,
        isActive: isActive !== undefined ? isActive === 'true' || isActive === true : existing.isActive
      };

      // Handle image
      if (req.file) {
        if (existing.image?.key) await deleteFromS3(existing.image.key).catch(console.error);
        updateData.image = {
          key: req.file.key,
          url: getS3Url(req.file.key),
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        };
      } else {
        updateData.image = existing.image;
      }

      const updated = await Terminal.findByIdAndUpdate(id, updateData, { new: true })
        .populate({
          path: 'airportID',
          populate: { path: 'cityID', select: 'cityName' }
        });

      res.json({ success: true, message: 'Terminal updated', data: updated });
    } catch (error) {
      if (req.file) await deleteFromS3(req.file.key).catch(console.error);
      res.status(500).json({ success: false, message: error.message });
    }
});

// ============= UPDATE STATUS ONLY =============
router.patch('/:id/status', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({ success: false, message: 'isActive is required' });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }

    const terminal = await Terminal.findByIdAndUpdate(
      id,
      { isActive: isActive === 'true' || isActive === true },
      { new: true }
    ).populate({
      path: 'airportID',
      populate: { path: 'cityID', select: 'cityName' }
    });

    if (!terminal) {
      return res.status(404).json({ success: false, message: 'Terminal not found' });
    }

    res.json({ success: true, data: terminal });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============= UPDATE IMAGE ONLY =============
router.patch('/:id/image', 
  authenticateToken, authorizeAdmin,
  upload.single('image'), 
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Image is required' });
      }

      if (!mongoose.Types.ObjectId.isValid(id)) {
        await deleteFromS3(req.file.key);
        return res.status(400).json({ success: false, message: 'Invalid ID' });
      }

      const terminal = await Terminal.findById(id);
      if (!terminal) {
        await deleteFromS3(req.file.key);
        return res.status(404).json({ success: false, message: 'Terminal not found' });
      }

      // Delete old image
      if (terminal.image?.key) {
        await deleteFromS3(terminal.image.key).catch(console.error);
      }

      // Update with new image
      terminal.image = {
        key: req.file.key,
        url: getS3Url(req.file.key),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      };

      await terminal.save();
      await terminal.populate({
        path: 'airportID',
        populate: { path: 'cityID', select: 'cityName' }
      });

      res.json({ success: true, message: 'Image updated', data: terminal });
    } catch (error) {
      if (req.file) await deleteFromS3(req.file.key).catch(console.error);
      res.status(500).json({ success: false, message: error.message });
    }
});

// ============= DELETE TERMINAL =============
router.delete('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }

    const terminal = await Terminal.findById(id);
    if (!terminal) {
      return res.status(404).json({ success: false, message: 'Terminal not found' });
    }

    // Delete image if exists
    if (terminal.image?.key) {
      await deleteFromS3(terminal.image.key);
    }

    await Terminal.findByIdAndDelete(id);

    res.json({ success: true, message: 'Terminal deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============= GET TERMINALS BY AIRPORT =============
router.get('/airport/:airportId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { airportId } = req.params;
    const { isActive, page = 1, limit = 10 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(airportId)) {
      return res.status(400).json({ success: false, message: 'Invalid airport ID' });
    }

    const query = { airportID: airportId };
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const terminals = await Terminal.find(query)
      .populate({
        path: 'airportID',
        populate: { path: 'cityID', select: 'cityName' }
      })
      .sort({ terminalName: 1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Terminal.countDocuments(query);

    res.json({
      success: true,
      data: terminals,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        hasNextPage: pageNum < Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;