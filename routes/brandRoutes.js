const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Brand = require('../models/brandModel');
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

// ============= CREATE BRAND =============
// POST /api/brands
router.post('/', authenticateToken, authorizeAdmin, upload.single('brandIcon'), async (req, res) => {
  try {
    const { brandName, isActive = true } = req.body;

    console.log('Create brand - body:', req.body);
    console.log('Create brand - file:', req.file);

    // Validate required fields
    if (!brandName) {
      if (req.file) await deleteFromS3(req.file.key);
      return res.status(400).json({ 
        success: false, 
        message: 'Brand name is required' 
      });
    }

    // Check for duplicate brand name (case insensitive)
    const existingBrand = await Brand.findOne({ 
      brandName: { $regex: new RegExp(`^${brandName.trim()}$`, 'i') } 
    });

    if (existingBrand) {
      if (req.file) await deleteFromS3(req.file.key);
      return res.status(400).json({ 
        success: false, 
        message: 'Brand with this name already exists' 
      });
    }

    // Prepare brand data
    const brandData = {
      brandName: brandName.trim(),
      isActive: isActive === 'true' || isActive === true,
      brandIcon: req.file ? formatFile(req.file) : null
    };

    const brand = await Brand.create(brandData);

    res.status(201).json({
      success: true,
      message: brandData.brandIcon ? 'Brand created with icon' : 'Brand created without icon',
      data: brand
    });

  } catch (error) {
    if (req.file) await deleteFromS3(req.file.key);
    console.error('Create brand error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Brand name already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ============= GET ALL BRANDS =============
// GET /api/brands?page=1&limit=10&isActive=true&search=bmw
router.get('/', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { 
      isActive, 
      search, 
      page = 1, 
      limit = 10 
    } = req.query;

    // Build query
    const query = {};
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (search) query.brandName = { $regex: search, $options: 'i' };

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [brands, total] = await Promise.all([
      Brand.find(query)
        .sort({ brandName: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Brand.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: brands,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get brands error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ============= GET ACTIVE BRANDS =============
// GET /api/brands/active
router.get('/active',authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const brands = await Brand.find({ isActive: true })
      .sort({ brandName: 1 });

    res.json({
      success: true,
      count: brands.length,
      data: brands
    });

  } catch (error) {
    console.error('Get active brands error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ============= GET BRAND BY ID =============
// GET /api/brands/:id
router.get('/:id',authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid brand ID format' 
      });
    }

    const brand = await Brand.findById(id);
    
    if (!brand) {
      return res.status(404).json({ 
        success: false, 
        message: 'Brand not found' 
      });
    }

    res.json({ success: true, data: brand });

  } catch (error) {
    console.error('Get brand error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ============= UPDATE BRAND =============
// PUT /api/brands/:id
router.put('/:id', authenticateToken, authorizeAdmin, upload.single('brandIcon'), async (req, res) => {
  try {
    const { id } = req.params;
    const { brandName, isActive } = req.body;

    console.log('Update brand - id:', id);
    console.log('Update brand - body:', req.body);
    console.log('Update brand - file:', req.file);

    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      if (req.file) await deleteFromS3(req.file.key);
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid brand ID format' 
      });
    }

    // Find existing brand
    const brand = await Brand.findById(id);
    if (!brand) {
      if (req.file) await deleteFromS3(req.file.key);
      return res.status(404).json({ 
        success: false, 
        message: 'Brand not found' 
      });
    }

    // Check for duplicate name if name is being changed
    if (brandName && brandName.trim().toLowerCase() !== brand.brandName.toLowerCase()) {
      const existingBrand = await Brand.findOne({ 
        brandName: { $regex: new RegExp(`^${brandName.trim()}$`, 'i') },
        _id: { $ne: id }
      });

      if (existingBrand) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({ 
          success: false, 
          message: 'Brand name already exists' 
        });
      }
    }

    // Prepare update data
    const updateData = {};
    if (brandName) updateData.brandName = brandName.trim();
    if (isActive !== undefined) {
      updateData.isActive = isActive === 'true' || isActive === true;
    }

    // Handle icon update
    if (req.file) {
      // Delete old icon
      if (brand.brandIcon?.key) {
        await deleteFromS3(brand.brandIcon.key).catch(() => {});
      }
      updateData.brandIcon = formatFile(req.file);
    }

    // Update brand
    const updatedBrand = await Brand.findByIdAndUpdate(
      id, 
      updateData, 
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: req.file ? 'Brand updated with new icon' : 'Brand updated',
      data: updatedBrand
    });

  } catch (error) {
    if (req.file) await deleteFromS3(req.file.key);
    console.error('Update brand error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: 'Brand name already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ============= TOGGLE BRAND STATUS =============
// PATCH /api/brands/:id/toggle
router.patch('/:id/toggle', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid brand ID format' 
      });
    }

    const brand = await Brand.findById(id);
    if (!brand) {
      return res.status(404).json({ 
        success: false, 
        message: 'Brand not found' 
      });
    }

    brand.isActive = !brand.isActive;
    await brand.save();

    res.json({
      success: true,
      message: `Brand ${brand.isActive ? 'activated' : 'deactivated'}`,
      data: { isActive: brand.isActive }
    });

  } catch (error) {
    console.error('Toggle brand error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ============= DELETE BRAND =============
// DELETE /api/brands/:id
router.delete('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid brand ID format' 
      });
    }

    const brand = await Brand.findById(id);
    if (!brand) {
      return res.status(404).json({ 
        success: false, 
        message: 'Brand not found' 
      });
    }

    // Delete icon from S3
    if (brand.brandIcon?.key) {
      await deleteFromS3(brand.brandIcon.key).catch(() => {});
    }

    await Brand.findByIdAndDelete(id);

    res.json({ 
      success: true, 
      message: 'Brand deleted successfully' 
    });

  } catch (error) {
    console.error('Delete brand error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

module.exports = router;