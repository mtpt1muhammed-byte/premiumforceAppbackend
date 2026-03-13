const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const City = require('../models/city_model');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');

// ============= CREATE CITY with Image =============
// POST /api/cities - Create a new city
router.post('/', 
  authenticateToken,
  authorizeAdmin,
  upload.single('image'), 
  async (req, res) => {
    try {
      console.log('Request body:', req.body);
      console.log('Request file:', req.file);

      const { cityName, isActive } = req.body;

      // Validation
      if (!cityName) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'City name is required'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'City image is required'
        });
      }

      // Check if city already exists
      const existingCity = await City.findOne({ 
        cityName: { $regex: new RegExp(`^${cityName}$`, 'i') } 
      });

      if (existingCity) {
        await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'City with this name already exists'
        });
      }

      // Create city data
      const cityData = {
        cityName: String(cityName).trim(),
        image: {
          key: req.file.key,
          url: getS3Url(req.file.key),
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        },
        isActive: isActive === 'true' || isActive === true
      };

      const city = new City(cityData);
      await city.save();

      res.status(201).json({
        success: true,
        message: 'City created successfully',
        data: city
      });
      
    } catch (error) {
      console.error('Create city error:', error);
      
      // Delete uploaded file if error occurs
      if (req.file) {
        await deleteFromS3(req.file.key).catch(console.error);
      }

      if (error.name === 'ValidationError') {
        const errors = {};
        for (let field in error.errors) {
          errors[field] = error.errors[field].message;
        }
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors
        });
      }

      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'City with this name already exists'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error creating city',
        error: error.message
      });
    }
});



// ============= GET ALL CITIES with Pagination =============
// GET /api/cities - Get all cities with filtering and pagination
router.get('/', async (req, res) => {
  try {
    const { 
      search,
      isActive,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};

    if (search) {
      query.cityName = { $regex: search, $options: 'i' };
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Sort
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Get cities
    const cities = await City.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    // Get total count
    const total = await City.countDocuments(query);

    res.json({
      success: true,
      message: 'Cities fetched successfully',
      data: cities,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < Math.ceil(total / limitNum),
        hasPrevPage: pageNum > 1
      }
    });
  } catch (error) {
    console.error('Get cities error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching cities',
      error: error.message
    });
  }
});

// ============= GET CITY BY ID =============
// GET /api/cities/:id - Get single city
router.get('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid city ID format'
      });
    }

    const city = await City.findById(id);

    if (!city) {
      return res.status(404).json({
        success: false,
        message: 'City not found'
      });
    }

    res.json({
      success: true,
      data: city
    });
  } catch (error) {
    console.error('Get city error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching city',
      error: error.message
    });
  }
});

// ============= UPDATE CITY =============
// PUT /api/cities/:id - Update city
router.put('/:id', 
  authenticateToken,
  authorizeAdmin,
  upload.single('image'), 
  async (req, res) => {
    try {
      console.log('Update city - ID:', req.params.id);
      console.log('Request body:', req.body);
      console.log('Request file:', req.file);

      const { id } = req.params;
      const { cityName, isActive } = req.body;

      // Validate ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'Invalid city ID format'
        });
      }

      // Check if city exists
      const existingCity = await City.findById(id);
      if (!existingCity) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(404).json({
          success: false,
          message: 'City not found'
        });
      }

      // Check if city name is taken by another city
      if (cityName) {
        const nameExists = await City.findOne({
          _id: { $ne: id },
          cityName: { $regex: new RegExp(`^${cityName}$`, 'i') }
        });

        if (nameExists) {
          if (req.file) await deleteFromS3(req.file.key);
          return res.status(400).json({
            success: false,
            message: 'City with this name already exists'
          });
        }
      }

      // Prepare update data
      const updateData = {
        cityName: cityName ? String(cityName).trim() : existingCity.cityName,
        isActive: isActive !== undefined ? isActive === 'true' || isActive === true : existingCity.isActive
      };

      // Handle image update
      if (req.file) {
        // Delete old image
        if (existingCity.image && existingCity.image.key) {
          await deleteFromS3(existingCity.image.key).catch(console.error);
        }
        
        // Add new image
        updateData.image = {
          key: req.file.key,
          url: getS3Url(req.file.key),
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        };
      }

      // Update city
      const updatedCity = await City.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
      );

      res.status(200).json({
        success: true,
        message: 'City updated successfully',
        data: updatedCity
      });

    } catch (error) {
      console.error('Update city error:', error);
      
      // Delete newly uploaded file if error occurs
      if (req.file) {
        await deleteFromS3(req.file.key).catch(console.error);
      }

      if (error.name === 'ValidationError') {
        const errors = {};
        for (let field in error.errors) {
          errors[field] = error.errors[field].message;
        }
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error updating city',
        error: error.message
      });
    }
});


// ============= UPDATE CITY STATUS =============
// PATCH /api/cities/:id/status - Update only city active status
router.patch('/:id/status', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isActive status is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid city ID format'
      });
    }

    const city = await City.findById(id);
    if (!city) {
      return res.status(404).json({
        success: false,
        message: 'City not found'
      });
    }

    const updatedCity = await City.findByIdAndUpdate(
      id,
      { isActive: isActive === 'true' || isActive === true },
      { new: true }
    );

    res.json({
      success: true,
      message: `City status updated to ${updatedCity.isActive ? 'active' : 'inactive'}`,
      data: updatedCity
    });
  } catch (error) {
    console.error('Update city status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating city status',
      error: error.message
    });
  }
});

// ============= UPDATE CITY IMAGE =============
// PATCH /api/cities/:id/image - Update only city image
router.patch('/:id/image', 
  authenticateToken,
  authorizeAdmin,
  upload.single('image'), 
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'City image is required'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(id)) {
        await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'Invalid city ID format'
        });
      }

      const city = await City.findById(id);
      if (!city) {
        await deleteFromS3(req.file.key);
        return res.status(404).json({
          success: false,
          message: 'City not found'
        });
      }

      // Delete old image
      if (city.image?.key) {
        await deleteFromS3(city.image.key).catch(console.error);
      }

      // Update with new image
      city.image = {
        key: req.file.key,
        url: getS3Url(req.file.key),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      };

      await city.save();

      res.json({
        success: true,
        message: 'City image updated successfully',
        data: {
          image: city.image
        }
      });
    } catch (error) {
      if (req.file) {
        await deleteFromS3(req.file.key).catch(console.error);
      }
      console.error('Update city image error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating city image',
        error: error.message
      });
    }
});

// ============= DELETE CITY =============
// DELETE /api/cities/:id - Delete city and associated image
router.delete('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid city ID format'
      });
    }

    const city = await City.findById(id);

    if (!city) {
      return res.status(404).json({
        success: false,
        message: 'City not found'
      });
    }

    // Delete image from S3
    if (city.image?.key) {
      await deleteFromS3(city.image.key);
    }

    await City.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'City deleted successfully'
    });
  } catch (error) {
    console.error('Delete city error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting city',
      error: error.message
    });
  }
});

// ============= GET CITY IMAGE =============
// GET /api/cities/:id/image - Get city image URL
router.get('/:id/image', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid city ID format'
      });
    }

    const city = await City.findById(id).select('image');
    
    if (!city) {
      return res.status(404).json({
        success: false,
        message: 'City not found'
      });
    }

    if (!city.image) {
      return res.status(404).json({
        success: false,
        message: 'City image not found'
      });
    }

    res.json({
      success: true,
      data: city.image
    });
  } catch (error) {
    console.error('Fetch city image error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching city image',
      error: error.message
    });
  }
});

module.exports = router;