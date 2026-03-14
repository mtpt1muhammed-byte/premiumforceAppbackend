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
// ============= CREATE CAR =============
// POST /api/cars - Create a new car with image
router.post('/', 
  authMiddleware, 
  adminMiddleware,
  upload.single('carImage'), 
  async (req, res) => {
    try {
      console.log('========== CREATE CAR DEBUG ==========');
      console.log('Request body (raw):', req.body);
      console.log('Request file:', req.file);
      console.log('Content-Type:', req.headers['content-type']);

      // Clean up field names by trimming spaces
      const cleanBody = {};
      Object.keys(req.body).forEach(key => {
        const cleanKey = key.trim();
        cleanBody[cleanKey] = typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key];
      });
      
      console.log('Cleaned body:', cleanBody);

      const {
        carName, brand, model, numberOfPassengers,
        minimumChargeDistance, minCharge, Category, category,
        vat
      } = cleanBody;

      // Use either Category or category (case-insensitive)
      const finalCategory = Category || category;
      
      console.log('Final Category value:', finalCategory);


      
      // Check if car image is uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Car image is required. Please select an image file.'
        });
      }

      // Validation for required fields
      const missingFields = [];
      if (!carName) missingFields.push('carName');
      if (!brand) missingFields.push('brand');
      if (!model) missingFields.push('model');
      if (!numberOfPassengers) missingFields.push('numberOfPassengers');
      if (!minimumChargeDistance) missingFields.push('minimumChargeDistance');
      if (!minCharge) missingFields.push('minCharge');
      if (!finalCategory) missingFields.push('category');
      if (!vat) missingFields.push('vat');

      if (missingFields.length > 0) {
        if (req.file) {
          await deleteFromS3(req.file.key);
        }
        return res.status(400).json({
          success: false,
          message: `Missing required fields: ${missingFields.join(', ')}`,
          received: cleanBody
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
        carName: { $regex: new RegExp(`^${carName}$`, 'i') },
        model: { $regex: new RegExp(`^${model}$`, 'i') }
      });

      if (existingCar) {
        if (req.file) {
          await deleteFromS3(req.file.key);
        }
        
        return res.status(409).json({
          success: false,
          message: 'Car with this name and model already exists',
          existingCar: {
            carId: existingCar.carId,
            carName: existingCar.carName,
            brand: existingCar.brand,
            model: existingCar.model,
            category: existingCar.category,
            numberOfPassengers: existingCar.numberOfPassengers,
            minCharge: existingCar.minCharge,
            minimumChargeDistance: existingCar.minimumChargeDistance,
            vat: existingCar.vat

          }
        });
      }

      // Create car object
      const carData = {
        carName: String(carName),
        brand: String(brand),
        model: String(model),
        category: String(finalCategory),
        numberOfPassengers: passengers,
        minCharge: String(minCharge),
        minimumChargeDistance: String(minimumChargeDistance),
        vat: String(vat),
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
        carName, brand, model, category, numberOfPassengers, minCharge, minimumChargeDistance,
        vat
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
        const newCarName = carName ? String(carName).trim() : car.carName;
        const newModel = model ? String(model).trim() : car.model;
        
        const existingCar = await Car.findOne({
          _id: { $ne: id },
          carName: { $regex: new RegExp(`^${newCarName}$`, 'i') },
          model: { $regex: new RegExp(`^${newModel}$`, 'i') }
        });

        if (existingCar) {
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
              category: existingCar.category,
              numberOfPassengers: existingCar.numberOfPassengers,
              minCharge: existingCar.minCharge,
              minimumChargeDistance: existingCar.minimumChargeDistance,
              vat: existingCar.vat
            }
          });
        }

        if (carName && model) {
          const sameNameDifferentModel = await Car.findOne({
            _id: { $ne: id },
            carName: { $regex: new RegExp(`^${newCarName}$`, 'i') },
            model: { $ne: newModel }
          });

          if (sameNameDifferentModel) {
            console.log(`Warning: Another car with name "${newCarName}" exists with different model: ${sameNameDifferentModel.model}`);
          }
        }
      }

      // Update fields if provided
      if (carName) car.carName = String(carName).trim();
      if (brand) car.brand = String(brand).trim();
      if (model) car.model = String(model).trim();
      if (category) car.category = String(category).trim();
      if (numberOfPassengers) car.numberOfPassengers = passengers;
      if (minCharge) car.minCharge = String(minCharge).trim();
      if (minimumChargeDistance) car.minimumChargeDistance = String(minimumChargeDistance).trim();
if (vat) car.vat = String(vat).trim();
      // Handle image update if new image is uploaded
      if (req.file) {
        const oldImageKey = car.carImage?.key;

        car.carImage = {
          key: req.file.key,
          url: getS3Url(req.file.key),
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        };

        await car.save();

        if (oldImageKey) {
          await deleteFromS3(oldImageKey).catch(err => 
            console.error('Error deleting old car image:', err)
          );
        }
      } else {
        await car.save();
      }

      res.json({
        success: true,
        message: 'Car updated successfully',
        data: car
      });
    } catch (error) {
      console.error('Update car error:', error);
      
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

      if (error.code === 11000) {
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

// ============= GET ALL CARS =============
// GET /api/cars - Get all cars with filtering and search
router.get('/', async (req, res) => {
  try {
    const { 
      search,
      brand,
      category,
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

    // Filter by category
    if (category) {
      query.category = { $regex: new RegExp(category, 'i') };
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

    // Get unique brands and categories for filter
    const [brands, categories] = await Promise.all([
      Car.distinct('brand'),
      Car.distinct('category')
    ]);

    res.json({
      success: true,
      count: cars.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      filters: {
        availableBrands: brands,
        availableCategories: categories
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
router.get('/:id', async (req, res) => {
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



// PATCH /api/cars/:id/min-charge - Update only the minimum charge
router.patch('/:id/min-charge', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { minCharge } = req.body;

    if (!minCharge) {
      return res.status(400).json({
        success: false,
        message: 'Minimum charge is required'
      });
    }

    if (typeof minCharge !== 'string' && typeof minCharge !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Minimum charge must be a string or number'
      });
    }

    const minChargeValue = typeof minCharge === 'number' ? minCharge.toString() : minCharge;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid car ID format'
      });
    }

    const existingCar = await Car.findById(id);
    if (!existingCar) {
      return res.status(404).json({
        success: false,
        message: 'Car not found'
      });
    }

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
       category: updatedCar.category,
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

    if (!minimumChargeDistance) {
      return res.status(400).json({
        success: false,
        message: 'Minimum charge distance is required'
      });
    }

    if (typeof minimumChargeDistance !== 'string' && typeof minimumChargeDistance !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Minimum charge distance must be a string or number'
      });
    }

    const minDistanceValue = typeof minimumChargeDistance === 'number' 
      ? minimumChargeDistance.toString() 
      : minimumChargeDistance;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid car ID format'
      });
    }

    const existingCar = await Car.findById(id);
    if (!existingCar) {
      return res.status(404).json({
        success: false,
        message: 'Car not found'
      });
    }

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
        category: updatedCar.category,
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

      if (car.carImage?.key) {
        await deleteFromS3(car.carImage.key).catch(err => 
          console.error('Error deleting old car image:', err)
        );
      }

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
    const car = await Car.findById(req.params.id).select('carImage carName brand model Category');
    
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
        category: car.category,
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

// ============= GET CARS BY CATEGORY =============
// GET /api/cars/category/:category - Get cars by category
router.get('/category/:category', authMiddleware, async (req, res) => {
  try {
    const { category } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const cars = await Car.find({ category: new RegExp(category, 'i') })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Car.countDocuments({ category: new RegExp(category, 'i') });

    res.json({
      success: true,
      count: cars.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: cars
    });
  } catch (error) {
    console.error('Get cars by category error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching cars by category',
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