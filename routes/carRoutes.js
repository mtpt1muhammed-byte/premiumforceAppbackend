const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Car = require('../models/car_model');
const authMiddleware = require('../middleware/authTheMiddle');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');

// Admin middleware to check if user is admin
const adminMiddleware = async (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.'
    });
  }
};

// ============= CREATE CAR =============
// POST /api/cars - Create a new car with image
router.post('/', 
  authMiddleware, 
  adminMiddleware,
  upload.single('carImage'), 
  async (req, res) => {
    try {
      console.log('Request body:', req.body);
      console.log('Request file:', req.file);

      const {
        carName, brand, model, numberOfPassengers
      } = req.body;

      // Validation for required fields
      if (!carName || !brand || !model || !numberOfPassengers) {
        if (req.file) {
          await deleteFromS3(req.file.key);
        }
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields: carName, brand, model, numberOfPassengers'
        });
      }

      // Check if car image is uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Car image is required'
        });
      }

      // Validate numberOfPassengers
      const passengers = parseInt(numberOfPassengers);
      if (isNaN(passengers) || passengers < 1) {
        await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'Number of passengers must be a valid positive number'
        });
      }

      // Create car object
      const carData = {
        carName: String(carName).trim(),
        brand: String(brand).trim(),
        model: String(model).trim(),
        numberOfPassengers: passengers,
        carImage: {
          key: req.file.key,
          url: getS3Url(req.file.key),
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        },
        createdBy: req.user._id
      };

      console.log('Car data to save:', carData);

      const car = new Car(carData);
      await car.save();

      res.status(201).json({
        success: true,
        message: 'Car created successfully',
        data: car
      });
    } catch (error) {
      console.error('Create car error:', error);
      
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
          message: 'Duplicate field value entered'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error creating car',
        error: error.message
      });
    }
});

// ============= GET ALL CARS =============
// GET /api/cars - Get all cars with filtering and search
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { 
      search,
      brand,
      minPassengers,
      maxPassengers,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    // Search functionality
    if (search) {
      query.$text = { $search: search };
    }

    // Filter by brand
    if (brand) {
      query.brand = brand;
    }

    // Filter by number of passengers
    if (minPassengers || maxPassengers) {
      query.numberOfPassengers = {};
      if (minPassengers) query.numberOfPassengers.$gte = parseInt(minPassengers);
      if (maxPassengers) query.numberOfPassengers.$lte = parseInt(maxPassengers);
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const cars = await Car.find(query)
      .populate('createdBy', 'username email')
      .sort(sort)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Car.countDocuments(query);

    // Get unique brands for filter
    const brands = await Car.distinct('brand');

    res.json({
      success: true,
      count: cars.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      filters: {
        availableBrands: brands
      },
      data: cars
    });
  } catch (error) {
    console.error('Get cars error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching cars',
      error: error.message
    });
  }
});

// ============= GET CAR BY ID =============
// GET /api/cars/:id - Get single car by MongoDB _id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const car = await Car.findById(req.params.id)
      .populate('createdBy', 'username email');

    if (!car) {
      return res.status(404).json({
        success: false,
        message: 'Car not found'
      });
    }

    res.json({
      success: true,
      data: car
    });
  } catch (error) {
    console.error('Get car error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid car ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error fetching car',
      error: error.message
    });
  }
});

// ============= GET CAR BY CAR ID =============
// GET /api/cars/carid/:carId - Get single car by custom carId
router.get('/carid/:carId', authMiddleware, async (req, res) => {
  try {
    const car = await Car.findOne({ carId: req.params.carId })
      .populate('createdBy', 'username email');

    if (!car) {
      return res.status(404).json({
        success: false,
        message: 'Car not found'
      });
    }

    res.json({
      success: true,
      data: car
    });
  } catch (error) {
    console.error('Get car by carId error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching car',
      error: error.message
    });
  }
});

// ============= UPDATE CAR =============
// PUT /api/cars/:id - Update car details
router.put('/:id', 
  authMiddleware, 
  adminMiddleware,
  upload.single('carImage'), 
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        carName, brand, model, numberOfPassengers
      } = req.body;

      // Find existing car
      const car = await Car.findById(id);
      if (!car) {
        if (req.file) {
          await deleteFromS3(req.file.key);
        }
        return res.status(404).json({
          success: false,
          message: 'Car not found'
        });
      }

      // Validate numberOfPassengers if provided
      let passengers = car.numberOfPassengers;
      if (numberOfPassengers) {
        passengers = parseInt(numberOfPassengers);
        if (isNaN(passengers) || passengers < 1) {
          if (req.file) {
            await deleteFromS3(req.file.key);
          }
          return res.status(400).json({
            success: false,
            message: 'Number of passengers must be a valid positive number'
          });
        }
      }

      // Update fields if provided
      if (carName) car.carName = String(carName).trim();
      if (brand) car.brand = String(brand).trim();
      if (model) car.model = String(model).trim();
      if (numberOfPassengers) car.numberOfPassengers = passengers;

      // Handle image update if new image is uploaded
      if (req.file) {
        // Delete old image from S3
        if (car.carImage?.key) {
          await deleteFromS3(car.carImage.key).catch(err => 
            console.error('Error deleting old car image:', err)
          );
        }

        // Set new image
        car.carImage = {
          key: req.file.key,
          url: getS3Url(req.file.key),
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        };
      }

      await car.save();

      res.json({
        success: true,
        message: 'Car updated successfully',
        data: car
      });
    } catch (error) {
      console.error('Update car error:', error);
      
      // Delete uploaded file if error occurs
      if (req.file) {
        await deleteFromS3(req.file.key).catch(console.error);
      }

      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid car ID format'
        });
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
        message: 'Error updating car',
        error: error.message
      });
    }
});

// ============= UPDATE CAR IMAGE ONLY =============
// PATCH /api/cars/:id/image - Update only car image
router.patch('/:id/image', 
  authMiddleware, 
  adminMiddleware,
  upload.single('carImage'), 
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Car image is required'
        });
      }

      const car = await Car.findById(req.params.id);
      if (!car) {
        await deleteFromS3(req.file.key);
        return res.status(404).json({
          success: false,
          message: 'Car not found'
        });
      }

      // Delete old image from S3
      if (car.carImage?.key) {
        await deleteFromS3(car.carImage.key).catch(err => 
          console.error('Error deleting old car image:', err)
        );
      }

      // Update with new image
      car.carImage = {
        key: req.file.key,
        url: getS3Url(req.file.key),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      };

      await car.save();

      res.json({
        success: true,
        message: 'Car image updated successfully',
        data: {
          carImage: car.carImage
        }
      });
    } catch (error) {
      if (req.file) {
        await deleteFromS3(req.file.key).catch(console.error);
      }
      console.error('Update car image error:', error);
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid car ID format'
        });
      }
      res.status(500).json({
        success: false,
        message: 'Error updating car image',
        error: error.message
      });
    }
});

// ============= DELETE CAR =============
// DELETE /api/cars/:id - Delete car and associated image
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);

    if (!car) {
      return res.status(404).json({
        success: false,
        message: 'Car not found'
      });
    }

    // Check if car is used in any bookings before deleting
    const Booking = mongoose.model('Booking');
    const activeBookings = await Booking.findOne({
      'carDetails.carId': car._id,
      bookingStatus: { $nin: ['completed', 'cancelled'] }
    });

    if (activeBookings) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete car as it is associated with active bookings'
      });
    }

    // Delete car image from S3
    if (car.carImage?.key) {
      await deleteFromS3(car.carImage.key);
    }

    await Car.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Car deleted successfully'
    });
  } catch (error) {
    console.error('Delete car error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid car ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error deleting car',
      error: error.message
    });
  }
});

// ============= GET CAR IMAGE =============
// GET /api/cars/:id/image - Get car image details
router.get('/:id/image', authMiddleware, async (req, res) => {
  try {
    const car = await Car.findById(req.params.id).select('carImage carName brand model');
    
    if (!car) {
      return res.status(404).json({
        success: false,
        message: 'Car not found'
      });
    }

    if (!car.carImage) {
      return res.status(404).json({
        success: false,
        message: 'Car image not found'
      });
    }

    res.json({
      success: true,
      data: {
        carId: car.carId,
        carName: car.carName,
        brand: car.brand,
        model: car.model,
        carImage: car.carImage
      }
    });
  } catch (error) {
    console.error('Fetch car image error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid car ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error fetching car image',
      error: error.message
    });
  }
});

// ============= GET CARS BY BRAND =============
// GET /api/cars/brand/:brand - Get cars by brand
router.get('/brand/:brand', authMiddleware, async (req, res) => {
  try {
    const { brand } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const cars = await Car.find({ brand: new RegExp(brand, 'i') })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Car.countDocuments({ brand: new RegExp(brand, 'i') });

    res.json({
      success: true,
      count: cars.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: cars
    });
  } catch (error) {
    console.error('Get cars by brand error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching cars by brand',
      error: error.message
    });
  }
});

// ============= GET CARS BY PASSENGER CAPACITY =============
// GET /api/cars/passengers/:count - Get cars by passenger capacity
router.get('/passengers/:count', authMiddleware, async (req, res) => {
  try {
    const { count } = req.params;
    const minPassengers = parseInt(count);

    const cars = await Car.find({ numberOfPassengers: { $gte: minPassengers } })
      .sort({ numberOfPassengers: 1 });

    res.json({
      success: true,
      count: cars.length,
      data: cars
    });
  } catch (error) {
    console.error('Get cars by passenger count error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching cars by passenger capacity',
      error: error.message
    });
  }
});

module.exports = router;
