const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Car = require('../models/car_model');
const authMiddleware = require('../middleware/authTheMiddle');
const { upload, deleteFromS3, getS3Url } = require('../config/car_s3');


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
        carName, brand, model, numberOfPassengers,
        minimumChargeDistance, minCharge
      } = req.body;

      // Validation for required fields
      if (!carName || !brand || !model || !numberOfPassengers || !minimumChargeDistance || !minCharge) {
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

      // CHECK IF CAR ALREADY EXISTS WITH SAME NAME AND MODEL
      const existingCar = await Car.findOne({
        carName: { $regex: new RegExp(`^${carName.trim()}$`, 'i') }, // Case-insensitive match
        model: { $regex: new RegExp(`^${model.trim()}$`, 'i') } // Case-insensitive match
      });

      if (existingCar) {
        // Delete uploaded file since car already exists
        if (req.file) {
          await deleteFromS3(req.file.key);
        }
        
        return res.status(409).json({ // 409 Conflict status code
          success: false,
          message: 'Car with this name and model already exists',
          existingCar: {
            carId: existingCar.carId,
            carName: existingCar.carName,
            brand: existingCar.brand,
            model: existingCar.model,
            numberOfPassengers: existingCar.numberOfPassengers,
            minCharge: existingCar.minCharge,
            minimumChargeDistance: existingCar.minimumChargeDistance
          }
        });
      }

      // Optional: Check if same car name exists with different model (warning)
      const sameNameDifferentModel = await Car.findOne({
        carName: { $regex: new RegExp(`^${carName.trim()}$`, 'i') },
        model: { $ne: model }
      });

      if (sameNameDifferentModel) {
        console.log(`Warning: Car with name "${carName}" exists with different model: ${sameNameDifferentModel.model}`);
        // You can still proceed with creation, just logging a warning
      }

      // Create car object
      const carData = {
        carName: String(carName).trim(),
        brand: String(brand).trim(),
        model: String(model).trim(),
        numberOfPassengers: passengers,
        minCharge: String(minCharge).trim(),
        minimumChargeDistance: String(minimumChargeDistance).trim(),
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
        carName, brand, model, numberOfPassengers, minCharge, minimumChargeDistance
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

      // CHECK IF ANOTHER CAR ALREADY EXISTS WITH SAME NAME AND MODEL (excluding current car)
      if (carName || model) {
        const searchCriteria = {};
        
        // Only check if both carName and model are being updated or provided
        const newCarName = carName ? String(carName).trim() : car.carName;
        const newModel = model ? String(model).trim() : car.model;
        
        // Find any other car with the same carName and model combination
        const existingCar = await Car.findOne({
          _id: { $ne: id }, // Exclude current car
          carName: { $regex: new RegExp(`^${newCarName}$`, 'i') },
          model: { $regex: new RegExp(`^${newModel}$`, 'i') }
        });

        if (existingCar) {
          // Delete uploaded file if car already exists
          if (req.file) {
            await deleteFromS3(req.file.key);
          }
          
          return res.status(409).json({
            success: false,
            message: 'Another car with this name and model already exists',
            existingCar: {
              carId: existingCar.carId,
              carName: existingCar.carName,
              brand: existingCar.brand,
              model: existingCar.model,
              numberOfPassengers: existingCar.numberOfPassengers,
              minCharge: existingCar.minCharge,
              minimumChargeDistance: existingCar.minimumChargeDistance
            }
          });
        }

        // Optional: Check if same car name exists with different model (warning)
        if (carName && model) {
          const sameNameDifferentModel = await Car.findOne({
            _id: { $ne: id },
            carName: { $regex: new RegExp(`^${newCarName}$`, 'i') },
            model: { $ne: newModel }
          });

          if (sameNameDifferentModel) {
            console.log(`Warning: Another car with name "${newCarName}" exists with different model: ${sameNameDifferentModel.model}`);
            // You can still proceed with update, just logging a warning
          }
        }
      }

      // Update fields if provided
      if (carName) car.carName = String(carName).trim();
      if (brand) car.brand = String(brand).trim();
      if (model) car.model = String(model).trim();
      if (numberOfPassengers) car.numberOfPassengers = passengers;
      if (minCharge) car.minCharge = String(minCharge).trim();
      if (minimumChargeDistance) car.minimumChargeDistance = String(minimumChargeDistance).trim();

      // Handle image update if new image is uploaded
      if (req.file) {
        // Store old image key for deletion after successful update
        const oldImageKey = car.carImage?.key;

        // Set new image
        car.carImage = {
          key: req.file.key,
          url: getS3Url(req.file.key),
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        };

        // Save the car first
        await car.save();

        // Delete old image from S3 only after successful save
        if (oldImageKey) {
          await deleteFromS3(oldImageKey).catch(err => 
            console.error('Error deleting old car image:', err)
          );
        }
      } else {
        // Just save without image update
        await car.save();
      }

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

      // Handle duplicate key error from compound index
      if (error.code === 11000) {
        // Check which fields caused the duplicate
        if (error.keyPattern && error.keyPattern.carName && error.keyPattern.model) {
          return res.status(409).json({
            success: false,
            message: `Another car with name "${req.body.carName || car.carName}" and model "${req.body.model || car.model}" already exists`
          });
        }
        return res.status(400).json({
          success: false,
          message: 'Duplicate field value entered'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error updating car',
        error: error.message
      });
    }
});


// PATCH /api/cars/:id/min-charge - Update only the minimum charge
router.patch('/:id/min-charge', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { minCharge } = req.body;

    // Validate minCharge field
    if (!minCharge) {
      return res.status(400).json({
        success: false,
        message: 'Minimum charge is required'
      });
    }

    // Validate minCharge format
    if (typeof minCharge !== 'string' && typeof minCharge !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Minimum charge must be a string or number'
      });
    }

    // Convert to string if it's a number
    const minChargeValue = typeof minCharge === 'number' ? minCharge.toString() : minCharge;

    // Validate car ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid car ID format'
      });
    }

    // Check if car exists
    const existingCar = await Car.findById(id);
    if (!existingCar) {
      return res.status(404).json({
        success: false,
        message: 'Car not found'
      });
    }

    // Check authorization (optional - based on your requirements)
    if (existingCar.createdBy && existingCar.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this car'
      });
    }

    // Update only the minCharge field
    const updatedCar = await Car.findByIdAndUpdate(
      id,
      { 
        minCharge: minChargeValue,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    ).select('-__v');

    res.status(200).json({
      success: true,
      message: 'Minimum charge updated successfully',
      data: {
        _id: updatedCar._id,
        carName: updatedCar.carName,
        brand: updatedCar.brand,
        model: updatedCar.model,
        minCharge: updatedCar.minCharge,
        previousMinCharge: existingCar.minCharge,
        updatedAt: updatedCar.updatedAt
      }
    });

  } catch (error) {
    console.error('Update minimum charge error:', error);
    
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

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid car ID format'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating minimum charge',
      error: error.message
    });
  }
});

// ============= UPDATE MINIMUM CHARGE DISTANCE =============
// PATCH /api/cars/:id/min-charge-distance - Update only the minimum charge distance
router.patch('/:id/min-charge-distance', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { minimumChargeDistance } = req.body;

    // Validate minimumChargeDistance field
    if (!minimumChargeDistance) {
      return res.status(400).json({
        success: false,
        message: 'Minimum charge distance is required'
      });
    }

    // Validate minimumChargeDistance format
    if (typeof minimumChargeDistance !== 'string' && typeof minimumChargeDistance !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Minimum charge distance must be a string or number'
      });
    }

    // Convert to string if it's a number
    const minDistanceValue = typeof minimumChargeDistance === 'number' 
      ? minimumChargeDistance.toString() 
      : minimumChargeDistance;

    // Validate car ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid car ID format'
      });
    }

    // Check if car exists
    const existingCar = await Car.findById(id);
    if (!existingCar) {
      return res.status(404).json({
        success: false,
        message: 'Car not found'
      });
    }

    // Check authorization (optional - based on your requirements)
    if (existingCar.createdBy && existingCar.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this car'
      });
    }

    // Update only the minimumChargeDistance field
    const updatedCar = await Car.findByIdAndUpdate(
      id,
      { 
        minimumChargeDistance: minDistanceValue,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    ).select('-__v');

    res.status(200).json({
      success: true,
      message: 'Minimum charge distance updated successfully',
      data: {
        _id: updatedCar._id,
        carName: updatedCar.carName,
        brand: updatedCar.brand,
        model: updatedCar.model,
        minimumChargeDistance: updatedCar.minimumChargeDistance,
        previousMinimumChargeDistance: existingCar.minimumChargeDistance,
        updatedAt: updatedCar.updatedAt
      }
    });

  } catch (error) {
    console.error('Update minimum charge distance error:', error);
    
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

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid car ID format'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating minimum charge distance',
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
