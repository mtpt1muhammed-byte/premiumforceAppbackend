const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Airport = require('../models/airportsModel');
const City = require('../models/city_model');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');




// ============= CREATE AIRPORT =============
// POST /api/airports - Create a new airport (image optional)
router.post('/', 
  authenticateToken,
  authorizeAdmin,
  upload.single('image'), 
  async (req, res) => {
    try {
      console.log('Create airport - Body:', req.body);
      console.log('Create airport - File:', req.file);

      const { cityID, airportName, isActive, lat, long } = req.body;

      // Validation
      if (!cityID) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'City ID is required'
        });
      }

      if (!airportName) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'Airport name is required'
        });
      }

      // Validate cityID format
      if (!mongoose.Types.ObjectId.isValid(cityID)) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'Invalid city ID format'
        });
      }

      // Check if city exists
      const cityExists = await City.findById(cityID);
      if (!cityExists) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(404).json({
          success: false,
          message: 'City not found'
        });
      }

      // Check if airport already exists in this city
      const existingAirport = await Airport.findOne({
        cityID: cityID,
        airportName: { $regex: new RegExp(`^${airportName}$`, 'i') }
      });

      if (existingAirport) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'Airport with this name already exists in this city'
        });
      }

      // Prepare airport data - FIX: Include lat and long
      const airportData = {
        cityID: cityID,
        airportName: String(airportName).trim(),
        isActive: isActive === 'true' || isActive === true || isActive === undefined
      };

      // Add lat and long if provided
      if (lat !== undefined && lat !== null && lat !== '') {
        airportData.lat = Number(lat);
      }
      
      if (long !== undefined && long !== null && long !== '') {
        airportData.long = Number(long);
      }

      // Add image if uploaded
      if (req.file) {
        airportData.image = {
          key: req.file.key,
          url: getS3Url(req.file.key),
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        };
      }

      const airport = new Airport(airportData);
      await airport.save();

      // Populate city details
      await airport.populate('cityID', 'cityName isActive');

      res.status(201).json({
        success: true,
        message: 'Airport created successfully',
        data: airport
      });
      
    } catch (error) {
      console.error('Create airport error:', error);
      
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

      res.status(500).json({
        success: false,
        message: 'Error creating airport',
        error: error.message
      });
    }
});



// ============= UPDATE AIRPORT =============
// PUT /api/airports/:id - Update airport (image optional)
router.put('/:id', 
  authenticateToken,
  authorizeAdmin,
  upload.single('image'), 
  async (req, res) => {
    try {
      console.log('Update airport - ID:', req.params.id);
      console.log('Request body:', req.body);
      console.log('Request file:', req.file);

      const { id } = req.params;
      const { cityID, airportName, isActive, lat, long } = req.body;

      // Validate ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'Invalid airport ID format'
        });
      }

      // Check if airport exists
      const existingAirport = await Airport.findById(id);
      if (!existingAirport) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(404).json({
          success: false,
          message: 'Airport not found'
        });
      }

      // Validate cityID if provided
      if (cityID) {
        if (!mongoose.Types.ObjectId.isValid(cityID)) {
          if (req.file) await deleteFromS3(req.file.key);
          return res.status(400).json({
            success: false,
            message: 'Invalid city ID format'
          });
        }

        const cityExists = await City.findById(cityID);
        if (!cityExists) {
          if (req.file) await deleteFromS3(req.file.key);
          return res.status(404).json({
            success: false,
            message: 'City not found'
          });
        }
      }

      // Check if airport name is taken in the same city
      if (airportName) {
        const nameExists = await Airport.findOne({
          _id: { $ne: id },
          cityID: cityID || existingAirport.cityID,
          airportName: { $regex: new RegExp(`^${airportName}$`, 'i') }
        });

        if (nameExists) {
          if (req.file) await deleteFromS3(req.file.key);
          return res.status(400).json({
            success: false,
            message: 'Airport with this name already exists in this city'
          });
        }
      }

      // Prepare update data - FIX: Include lat and long
      const updateData = {
        cityID: cityID || existingAirport.cityID,
        airportName: airportName ? String(airportName).trim() : existingAirport.airportName,
        isActive: isActive !== undefined ? isActive === 'true' || isActive === true : existingAirport.isActive
      };

      // Add lat if provided
      if (lat !== undefined && lat !== null && lat !== '') {
        updateData.lat = Number(lat);
      }
      
      // Add long if provided
      if (long !== undefined && long !== null && long !== '') {
        updateData.long = Number(long);
      }

      // Handle image update
      if (req.file) {
        // Delete old image if exists
        if (existingAirport.image && existingAirport.image.key) {
          await deleteFromS3(existingAirport.image.key).catch(console.error);
        }
        
        // Add new image
        updateData.image = {
          key: req.file.key,
          url: getS3Url(req.file.key),
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        };
      } else {
        // Keep existing image
        updateData.image = existingAirport.image;
      }

      // Update airport
      const updatedAirport = await Airport.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
      ).populate('cityID', 'cityName isActive'); // FIX: Remove extra parameters

      res.status(200).json({
        success: true,
        message: 'Airport updated successfully',
        data: updatedAirport
      });

    } catch (error) {
      console.error('Update airport error:', error);
      
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
        message: 'Error updating airport',
        error: error.message
      });
    }
});



// ============= GET ALL AIRPORTS with Pagination =============
// GET /api/airports - Get all airports with filtering and pagination
router.get('/', async (req, res) => {
  try {
    const { 
      cityID,
      search,
      isActive,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};

    if (cityID) {
      if (!mongoose.Types.ObjectId.isValid(cityID)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid city ID format'
        });
      }
      query.cityID = cityID;
    }

    if (search) {
      query.airportName = { $regex: search, $options: 'i' };
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

    // FIX: Correct populate syntax - use string with space-separated fields
    const airports = await Airport.find(query)
      .populate('cityID', 'cityName isActive lat long')  // Fixed: space-separated fields in a single string
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    // Get total count
    const total = await Airport.countDocuments(query);

    res.json({
      success: true,
      message: 'Airports fetched successfully',
      data: airports,
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
    console.error('Get airports error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching airports',
      error: error.message
    });
  }
});




// ============= GET AIRPORT BY ID =============
// GET /api/airports/:id - Get single airport
router.get('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid airport ID format'
      });
    }

    // FIX: Use a single string with space-separated fields
    const airport = await Airport.findById(id)
      .populate('cityID', 'cityName isActive lat long');  // Fixed: space-separated fields in one string

    if (!airport) {
      return res.status(404).json({
        success: false,
        message: 'Airport not found'
      });
    }

    res.json({
      success: true,
      data: airport
    });
  } catch (error) {
    console.error('Get airport error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching airport',
      error: error.message
    });
  }
});



// ============= UPDATE AIRPORT STATUS ONLY =============
// PATCH /api/airports/:id/status - Update only status
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
        message: 'Invalid airport ID format'
      });
    }

    const airport = await Airport.findById(id);
    if (!airport) {
      return res.status(404).json({
        success: false,
        message: 'Airport not found'
      });
    }

    const updatedAirport = await Airport.findByIdAndUpdate(
      id,
      { isActive: isActive === 'true' || isActive === true },
      { new: true }
    ).populate('cityID', 'cityName isActive');

    res.json({
      success: true,
      message: `Airport status updated to ${updatedAirport.isActive ? 'active' : 'inactive'}`,
      data: updatedAirport
    });
  } catch (error) {
    console.error('Update airport status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating airport status',
      error: error.message
    });
  }
});

// ============= UPDATE AIRPORT IMAGE ONLY =============
// PATCH /api/airports/:id/image - Update only image
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
          message: 'Image is required'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(id)) {
        await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'Invalid airport ID format'
        });
      }

      const airport = await Airport.findById(id);
      if (!airport) {
        await deleteFromS3(req.file.key);
        return res.status(404).json({
          success: false,
          message: 'Airport not found'
        });
      }

      // Delete old image if exists
      if (airport.image?.key) {
        await deleteFromS3(airport.image.key).catch(console.error);
      }

      // Update with new image
      airport.image = {
        key: req.file.key,
        url: getS3Url(req.file.key),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      };

      await airport.save();
      await airport.populate('cityID', 'cityName isActive');

      res.json({
        success: true,
        message: 'Airport image updated successfully',
        data: airport
      });
    } catch (error) {
      if (req.file) {
        await deleteFromS3(req.file.key).catch(console.error);
      }
      console.error('Update airport image error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating airport image',
        error: error.message
      });
    }
});

// ============= DELETE AIRPORT =============
// DELETE /api/airports/:id - Delete airport and associated image
router.delete('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid airport ID format'
      });
    }

    const airport = await Airport.findById(id);

    if (!airport) {
      return res.status(404).json({
        success: false,
        message: 'Airport not found'
      });
    }

    // Delete image from S3 if exists
    if (airport.image?.key) {
      await deleteFromS3(airport.image.key);
    }

    await Airport.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Airport deleted successfully'
    });
  } catch (error) {
    console.error('Delete airport error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting airport',
      error: error.message
    });
  }
});


// ============= GET AIRPORTS BY CITY ID =============
// GET /api/airports/city/:cityId - Get all airports for a specific city
router.get('/city/:cityId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { cityId } = req.params;
    const { isActive, page = 1, limit = 10 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(cityId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid city ID format'
      });
    }

    // Check if city exists
    const cityExists = await City.findById(cityId);
    if (!cityExists) {
      return res.status(404).json({
        success: false,
        message: 'City not found'
      });
    }

    // Build query
    const query = { cityID: cityId };
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Get airports
    const airports = await Airport.find(query)
      .populate('cityID', 'cityName isActive')
      .sort({ airportName: 1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Airport.countDocuments(query);

    res.json({
      success: true,
      message: 'Airports fetched successfully',
      data: airports,
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
    console.error('Get airports by city error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching airports',
      error: error.message
    });
  }
});




module.exports = router;