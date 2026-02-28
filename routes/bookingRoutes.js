// routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const Booking = require('../models/booking_model');
const authMiddleware = require('../middleware/authTheMiddle');

// Import S3 configuration from your central config file (like in userRoutes)
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');

// ============= CREATE BOOKING with Images =============
// POST /api/bookings - Create a new booking with car image and optional audio
router.post('/', 
  authMiddleware, 
  upload.fields([
    { name: 'carimage', maxCount: 1 },
    { name: 'specialRequestAudio', maxCount: 1 }
  ]), 
  async (req, res) => {
    try {
      console.log('Request body:', req.body);
      console.log('Request files:', req.files);

      const {
        category, city, airport, terminal, flightNumber, arrival,
        pickupLat, pickupLong, dropOffLat, dropOffLong, dropOffAddress,
        carName, charge,
        carclass, carbrand, carmodel, specialRequestText,
        passengerCount, passengerNames, passengerMobile, distance,
        customerID, bookingStatus,driverID
      } = req.body;

      // Validation for required fields
      if (!category || !city || !arrival || !pickupLat || !pickupLong || 
          !dropOffLat || !dropOffLong || !dropOffAddress || !carclass || 
          !carbrand || !carmodel || !passengerCount || !passengerNames || 
          !passengerMobile || !distance || !customerID || !charge || !carName || !driverID) {
        
        // Delete uploaded files if validation fails
        if (req.files) {
          if (req.files.carimage) {
            await deleteFromS3(req.files.carimage[0].key);
          }
          if (req.files.specialRequestAudio) {
            await deleteFromS3(req.files.specialRequestAudio[0].key);
          }
        }
        
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields'
        });
      }

      // Validate customerID format
      if (!mongoose.Types.ObjectId.isValid(customerID)) {
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid customer ID format'
        });
      }

      // Validate date
      const parsedDate = new Date(arrival);
      if (isNaN(parsedDate.getTime())) {
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid date format for arrival'
        });
      }

      // Check if car image is uploaded
      if (!req.files || !req.files.carimage || !req.files.carimage[0]) {
        return res.status(400).json({
          success: false,
          message: 'Car image is required'
        });
      }

      // CHECK FOR EXISTING BOOKING
      const existingBooking = await Booking.findOne({
        customerID: customerID,
        arrival: {
          $gte: new Date(parsedDate).setHours(0, 0, 0, 0),
          $lte: new Date(parsedDate).setHours(23, 59, 59, 999)
        },
        bookingStatus: { $nin: ['cancelled', 'completed'] }
      });

      if (existingBooking) {
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'You already have a booking scheduled for this date',
          existingBooking: {
            id: existingBooking._id,
            arrival: existingBooking.arrival,
            status: existingBooking.bookingStatus,
            driverID: existingBooking.driverID
          }
        });
      }

      // Parse passengerNames
      let parsedPassengerNames = [];
      if (typeof passengerNames === 'string') {
        try {
          parsedPassengerNames = JSON.parse(passengerNames);
        } catch {
          parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
        }
      } else if (Array.isArray(passengerNames)) {
        parsedPassengerNames = passengerNames;
      } else {
        parsedPassengerNames = [String(passengerNames)];
      }

      // Create booking object
      const bookingData = {
        category: String(category).trim(),
        city: String(city).trim(),
        airport: airport ? String(airport).trim() : undefined,
        terminal: terminal ? String(terminal).trim() : undefined,
        flightNumber: flightNumber ? String(flightNumber).trim() : undefined,
        arrival: parsedDate,
        pickupLat: parseFloat(pickupLat),
        pickupLong: parseFloat(pickupLong),
        dropOffLat: parseFloat(dropOffLat),
        dropOffLong: parseFloat(dropOffLong),
        dropOffAddress: String(dropOffAddress).trim(),
        carName: String(carName).trim(),
        carclass: String(carclass).trim(),
        carbrand: String(carbrand).trim(),
        carmodel: String(carmodel).trim(),
        charge: String(charge).trim(),
        carimage: {
          key: req.files.carimage[0].key,
          url: getS3Url(req.files.carimage[0].key),
          originalName: req.files.carimage[0].originalname,
          mimeType: req.files.carimage[0].mimetype,
          size: req.files.carimage[0].size
        },
        driverID: driverID,
        passengerCount: parseInt(passengerCount),
        passengerNames: parsedPassengerNames,
        passengerMobile: String(passengerMobile).trim(),
        distance: String(distance).trim(),
        customerID: customerID,
        bookingStatus: bookingStatus || 'pending',
        TrackingTimeLine: ['booking_created'],
        paymentStatus: false,
        rating: {}
      };

      // Add optional fields
      if (specialRequestText && specialRequestText.trim() !== '') {
        bookingData.specialRequestText = String(specialRequestText).trim();
      }

      if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio[0]) {
        bookingData.specialRequestAudio = {
          key: req.files.specialRequestAudio[0].key,
          url: getS3Url(req.files.specialRequestAudio[0].key),
          originalName: req.files.specialRequestAudio[0].originalname,
          mimeType: req.files.specialRequestAudio[0].mimetype,
          size: req.files.specialRequestAudio[0].size
        };
      }

      console.log('Booking data to save:', bookingData);

      const booking = new Booking(bookingData);
      await booking.save();

      res.status(201).json({
        success: true,
        message: 'Booking created successfully',
        data: booking
      });
    } catch (error) {
      console.error('Create booking error:', error);
      
      // Delete uploaded files if error occurs
      if (req.files) {
        if (req.files.carimage) {
          await deleteFromS3(req.files.carimage[0].key).catch(console.error);
        }
        if (req.files.specialRequestAudio) {
          await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
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
        message: 'Error creating booking',
        error: error.message
      });
    }
});





// UPDATE booking by ID
router.put('/:id', 
  authMiddleware, 
  upload.fields([
    { name: 'carimage', maxCount: 1 },
    { name: 'specialRequestAudio', maxCount: 1 }
  ]), 
  async (req, res) => {
    try {
      console.log('Update booking - ID:', req.params.id);
      console.log('Request body:', req.body);
      console.log('Request files:', req.files);

      const bookingId = req.params.id;

      // Validate booking ID
      if (!mongoose.Types.ObjectId.isValid(bookingId)) {
        // Delete uploaded files if validation fails
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid booking ID format'
        });
      }

      // Check if booking exists
      const existingBooking = await Booking.findById(bookingId);
      if (!existingBooking) {
        // Delete uploaded files if booking not found
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Extract fields from request body
      const {
        category, city, airport, terminal, flightNumber, arrival,
        pickupLat, pickupLong, dropOffLat, dropOffLong, dropOffAddress,
        carName, charge,
        carclass, carbrand, carmodel, specialRequestText,
        passengerCount, passengerNames, passengerMobile, distance,
        bookingStatus, driverID
      } = req.body;

      // Validate required fields (optional for update - you might want to make some fields optional)
      // You can adjust this validation based on which fields are required for update
      if (!category || !city || !arrival || !pickupLat || !pickupLong || 
          !dropOffLat || !dropOffLong || !dropOffAddress || !carclass || 
          !carbrand || !carmodel || !passengerCount || !passengerNames || 
          !passengerMobile || !distance || !charge || !carName || !driverID) {
        
        // Delete uploaded files if validation fails
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields'
        });
      }

      // Validate date if provided
      let parsedDate = existingBooking.arrival;
      if (arrival) {
        parsedDate = new Date(arrival);
        if (isNaN(parsedDate.getTime())) {
          if (req.files) {
            if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid date format for arrival'
          });
        }
      }

      // Parse passengerNames
      let parsedPassengerNames = existingBooking.passengerNames;
      if (passengerNames) {
        if (typeof passengerNames === 'string') {
          try {
            parsedPassengerNames = JSON.parse(passengerNames);
          } catch {
            parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
          }
        } else if (Array.isArray(passengerNames)) {
          parsedPassengerNames = passengerNames;
        } else {
          parsedPassengerNames = [String(passengerNames)];
        }
      }

      // Prepare update data
      const updateData = {
        category: category ? String(category).trim() : existingBooking.category,
        city: city ? String(city).trim() : existingBooking.city,
        airport: airport ? String(airport).trim() : existingBooking.airport,
        terminal: terminal ? String(terminal).trim() : existingBooking.terminal,
        flightNumber: flightNumber ? String(flightNumber).trim() : existingBooking.flightNumber,
        arrival: parsedDate,
        pickupLat: pickupLat ? parseFloat(pickupLat) : existingBooking.pickupLat,
        pickupLong: pickupLong ? parseFloat(pickupLong) : existingBooking.pickupLong,
        dropOffLat: dropOffLat ? parseFloat(dropOffLat) : existingBooking.dropOffLat,
        dropOffLong: dropOffLong ? parseFloat(dropOffLong) : existingBooking.dropOffLong,
        dropOffAddress: dropOffAddress ? String(dropOffAddress).trim() : existingBooking.dropOffAddress,
        carName: carName ? String(carName).trim() : existingBooking.carName,
        carclass: carclass ? String(carclass).trim() : existingBooking.carclass,
        carbrand: carbrand ? String(carbrand).trim() : existingBooking.carbrand,
        carmodel: carmodel ? String(carmodel).trim() : existingBooking.carmodel,
        charge: charge ? String(charge).trim() : existingBooking.charge,
        passengerCount: passengerCount ? parseInt(passengerCount) : existingBooking.passengerCount,
        passengerNames: parsedPassengerNames,
        passengerMobile: passengerMobile ? String(passengerMobile).trim() : existingBooking.passengerMobile,
        distance: distance ? String(distance).trim() : existingBooking.distance,
        bookingStatus: bookingStatus || existingBooking.bookingStatus,
        driverID: driverID || existingBooking.driverID,
        updatedAt: new Date() // Add timestamp for tracking
      };

      // Handle file updates
      
      // 1. Handle car image update
      if (req.files && req.files.carimage && req.files.carimage[0]) {
        // Delete old car image from S3 if exists
        if (existingBooking.carimage && existingBooking.carimage.key) {
          await deleteFromS3(existingBooking.carimage.key).catch(console.error);
        }
        
        // Add new car image
        updateData.carimage = {
          key: req.files.carimage[0].key,
          url: getS3Url(req.files.carimage[0].key),
          originalName: req.files.carimage[0].originalname,
          mimeType: req.files.carimage[0].mimetype,
          size: req.files.carimage[0].size
        };
      }

      // 2. Handle special request audio update
      if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio[0]) {
        // Delete old audio from S3 if exists
        if (existingBooking.specialRequestAudio && existingBooking.specialRequestAudio.key) {
          await deleteFromS3(existingBooking.specialRequestAudio.key).catch(console.error);
        }
        
        // Add new audio
        updateData.specialRequestAudio = {
          key: req.files.specialRequestAudio[0].key,
          url: getS3Url(req.files.specialRequestAudio[0].key),
          originalName: req.files.specialRequestAudio[0].originalname,
          mimeType: req.files.specialRequestAudio[0].mimetype,
          size: req.files.specialRequestAudio[0].size
        };
      }

      // 3. Handle special request text update
      if (specialRequestText !== undefined) {
        if (specialRequestText && specialRequestText.trim() !== '') {
          updateData.specialRequestText = String(specialRequestText).trim();
        } else {
          // If empty string is sent, remove the field
          updateData.$unset = { specialRequestText: 1 };
        }
      }

      // Add to tracking timeline
      updateData.$push = { TrackingTimeLine: 'booking_updated' };

      console.log('Update data:', updateData);

      // Update the booking
      const updatedBooking = await Booking.findByIdAndUpdate(
        bookingId,
        updateData,
        { new: true, runValidators: true } // Return updated document and run validators
      );

      res.status(200).json({
        success: true,
        message: 'Booking updated successfully',
        data: updatedBooking
      });

    } catch (error) {
      console.error('Update booking error:', error);
      
      // Delete newly uploaded files if error occurs
      if (req.files) {
        if (req.files.carimage) {
          await deleteFromS3(req.files.carimage[0].key).catch(console.error);
        }
        if (req.files.specialRequestAudio) {
          await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
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
        message: 'Error updating booking',
        error: error.message
      });
    }
});


// Optional: PATCH method for partial updates
router.patch('/:id', 
  authMiddleware, 
  upload.fields([
    { name: 'carimage', maxCount: 1 },
    { name: 'specialRequestAudio', maxCount: 1 }
  ]), 
  async (req, res) => {
    try {
      console.log('Partial update booking - ID:', req.params.id);
      // Similar to PUT but without required field validation
      // You can implement a more flexible version here
      
      const bookingId = req.params.id;

      // Validate booking ID
      if (!mongoose.Types.ObjectId.isValid(bookingId)) {
        // Delete uploaded files if validation fails
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid booking ID format'
        });
      }

      // Check if booking exists
      const existingBooking = await Booking.findById(bookingId);
      if (!existingBooking) {
        // Delete uploaded files if booking not found
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Build update object dynamically based on provided fields
      const updateData = {};
      const allowedFields = [
        'category', 'city', 'airport', 'terminal', 'flightNumber', 'arrival',
        'pickupLat', 'pickupLong', 'dropOffLat', 'dropOffLong', 'dropOffAddress',
        'carName', 'charge', 'carclass', 'carbrand', 'carmodel', 'specialRequestText',
        'passengerCount', 'passengerNames', 'passengerMobile', 'distance', 'bookingStatus'
      ];

      // Process each field if provided
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          switch (field) {
            case 'arrival':
              const date = new Date(req.body[field]);
              if (isNaN(date.getTime())) {
                return res.status(400).json({
                  success: false,
                  message: 'Invalid date format for arrival'
                });
              }
              updateData[field] = date;
              break;
              
            case 'pickupLat':
            case 'pickupLong':
            case 'dropOffLat':
            case 'dropOffLong':
              updateData[field] = parseFloat(req.body[field]);
              break;
              
            case 'passengerCount':
              updateData[field] = parseInt(req.body[field]);
              break;
              
            case 'passengerNames':
              if (typeof req.body[field] === 'string') {
                try {
                  updateData[field] = JSON.parse(req.body[field]);
                } catch {
                  updateData[field] = req.body[field].split(',').map(name => name.trim());
                }
              } else if (Array.isArray(req.body[field])) {
                updateData[field] = req.body[field];
              } else {
                updateData[field] = [String(req.body[field])];
              }
              break;
              
            case 'specialRequestText':
              if (req.body[field] && req.body[field].trim() !== '') {
                updateData[field] = String(req.body[field]).trim();
              } else {
                updateData.$unset = { ...updateData.$unset, [field]: 1 };
              }
              break;
              
            default:
              updateData[field] = String(req.body[field]).trim();
          }
        }
      }

      // Handle file updates (same as PUT method)
      if (req.files && req.files.carimage && req.files.carimage[0]) {
        if (existingBooking.carimage && existingBooking.carimage.key) {
          await deleteFromS3(existingBooking.carimage.key).catch(console.error);
        }
        updateData.carimage = {
          key: req.files.carimage[0].key,
          url: getS3Url(req.files.carimage[0].key),
          originalName: req.files.carimage[0].originalname,
          mimeType: req.files.carimage[0].mimetype,
          size: req.files.carimage[0].size
        };
      }

      if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio[0]) {
        if (existingBooking.specialRequestAudio && existingBooking.specialRequestAudio.key) {
          await deleteFromS3(existingBooking.specialRequestAudio.key).catch(console.error);
        }
        updateData.specialRequestAudio = {
          key: req.files.specialRequestAudio[0].key,
          url: getS3Url(req.files.specialRequestAudio[0].key),
          originalName: req.files.specialRequestAudio[0].originalname,
          mimeType: req.files.specialRequestAudio[0].mimetype,
          size: req.files.specialRequestAudio[0].size
        };
      }

      // Add update timestamp and tracking
      updateData.updatedAt = new Date();
      updateData.$push = { TrackingTimeLine: 'booking_updated' };

      const updatedBooking = await Booking.findByIdAndUpdate(
        bookingId,
        updateData,
        { new: true, runValidators: true }
      );

      res.status(200).json({
        success: true,
        message: 'Booking updated successfully',
        data: updatedBooking
      });

    } catch (error) {
      console.error('Partial update error:', error);
      // Error handling similar to PUT method
      res.status(500).json({
        success: false,
        message: 'Error updating booking',
        error: error.message
      });
    }
});



// ============= UPDATE BOOKING CHARGE =============
// PATCH /api/bookings/:id/charge - Update only the charge amount
router.patch('/:id/charge', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { charge } = req.body;
    // Validate charge field
    if (!charge) {
      return res.status(400).json({
        success: false,
        message: 'Charge amount is required'
      });
    }

    // Validate charge format (you can adjust this based on your requirements)
    if (typeof charge !== 'string' && typeof charge !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Charge must be a string or number'
      });
    }

    // Convert to string if it's a number
    const chargeValue = typeof charge === 'number' ? charge.toString() : charge;

    // Validate booking ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }

    // Check if booking exists
    const existingBooking = await Booking.findById(id);
    if (!existingBooking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Update only the charge field
    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      { 
        charge: chargeValue,
        updatedAt: new Date(),
        $push: { TrackingTimeLine: 'charge_updated' }
      },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Charge updated successfully',
      data: {
        bookingId: updatedBooking._id,
        charge: updatedBooking.charge,
        previousCharge: existingBooking.charge,
        updatedAt: updatedBooking.updatedAt
      }
    });

  } catch (error) {
    console.error('Update charge error:', error);
    
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
        message: 'Invalid booking ID format'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating charge',
      error: error.message
    });
  }
});

// Alternative: More flexible charge update with additional options
router.patch('/:id/charge-detailed', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { charge, chargeBreakdown, discount, tax, totalCharge } = req.body;

    // Validate booking ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }

    // Check if booking exists
    const existingBooking = await Booking.findById(id);
    if (!existingBooking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Build update object with charge-related fields
    const updateData = {
      updatedAt: new Date(),
      $push: { TrackingTimeLine: 'charge_details_updated' }
    };

    // Update main charge if provided
    if (charge !== undefined) {
      const chargeValue = typeof charge === 'number' ? charge.toString() : charge;
      if (!chargeValue) {
        return res.status(400).json({
          success: false,
          message: 'Charge cannot be empty'
        });
      }
      updateData.charge = chargeValue;
    }

    // Update charge breakdown if provided (if your schema supports it)
    if (chargeBreakdown !== undefined) {
      updateData.chargeBreakdown = chargeBreakdown;
    }

    // Update discount if provided (if your schema supports it)
    if (discount !== undefined) {
      updateData.discount = discount;
    }

    // Update tax if provided (if your schema supports it)
    if (tax !== undefined) {
      updateData.tax = tax;
    }

    // Update total charge if provided (if your schema supports it)
    if (totalCharge !== undefined) {
      const totalValue = typeof totalCharge === 'number' ? totalCharge.toString() : totalCharge;
      updateData.totalCharge = totalValue;
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    // Prepare response data
    const responseData = {
      bookingId: updatedBooking._id,
      charge: updatedBooking.charge,
      updatedAt: updatedBooking.updatedAt
    };

    // Include additional fields in response if they exist in the updated booking
    if (updatedBooking.chargeBreakdown) responseData.chargeBreakdown = updatedBooking.chargeBreakdown;
    if (updatedBooking.discount) responseData.discount = updatedBooking.discount;
    if (updatedBooking.tax) responseData.tax = updatedBooking.tax;
    if (updatedBooking.totalCharge) responseData.totalCharge = updatedBooking.totalCharge;

    res.status(200).json({
      success: true,
      message: 'Charge details updated successfully',
      data: responseData
    });

  } catch (error) {
    console.error('Update charge details error:', error);
    
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
        message: 'Invalid booking ID format'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating charge details',
      error: error.message
    });
  }
});


// ============= GET ALL BOOKINGS =============
// GET /api/bookings - Get all bookings with filtering
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { 
      customerID, 
      driverID, 
      status, 
      fromDate, 
      toDate,
      page = 1,
      limit = 10
    } = req.query;

    const query = {};

    if (customerID) query.customerID = customerID;
    if (driverID) query.driverID = driverID;
    if (status) query.bookingStatus = status;
    // if(paymentStatus) query.paymentStatus = paymentStatus;
    // if(charge) query.charge = charge;
    if (fromDate || toDate) {
      query.arrival = {};
      if (fromDate) query.arrival.$gte = new Date(fromDate);
      if (toDate) query.arrival.$lte = new Date(toDate);
    }

    const bookings = await Booking.find(query)
      .populate('customerID', 'username email phoneNumber profileImage')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Booking.countDocuments(query);

    res.json({
      success: true,
      count: bookings.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: bookings
    });
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bookings',
      error: error.message
    });
  }
});

// ============= GET BOOKING BY ID =============
// GET /api/bookings/:id - Get single booking
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('customerID', 'username email phoneNumber profileImage');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Get booking error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error fetching booking',
      error: error.message
    });
  }
});

// ============= UPDATE BOOKING STATUS =============
// PATCH /api/bookings/:id/status - Update booking status
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status, driverID } = req.body;
    const { id } = req.params;

    const validStatuses = ['pending', 'confirmed', 'assigned', 'in_progress', 'completed', 'cancelled'];
    
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required'
      });
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const updateData = {
      bookingStatus: status,
      $push: { TrackingTimeLine: `booking_${status}` }
    };

    if (driverID && status === 'assigned') {
      if (!mongoose.Types.ObjectId.isValid(driverID)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid driver ID format'
        });
      }
      updateData.driverID = driverID;
    }

    if (status === 'completed') {
      updateData.paymentStatus = true;
      updateData.paymentCompletedAt = new Date();
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    res.json({
      success: true,
      message: `Booking status updated to ${status}`,
      data: updatedBooking
    });
  } catch (error) {
    console.error('Update booking status error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error updating booking status',
      error: error.message
    });
  }
});

// ============= ADD RATING TO BOOKING =============
// PATCH /api/bookings/:id/rating - Add rating
router.patch('/:id/rating', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const ratingData = req.body;

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      { rating: ratingData },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Rating added successfully',
      data: updatedBooking
    });
  } catch (error) {
    console.error('Add rating error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error adding rating',
      error: error.message
    });
  }
});

// ============= UPDATE PAYMENT STATUS =============
// PATCH /api/bookings/:id/payment - Update payment status
router.patch('/:id/payment', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus } = req.body;

    if (typeof paymentStatus !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Payment status must be boolean'
      });
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const updateData = {
      paymentStatus,
      paymentCompletedAt: paymentStatus ? new Date() : null
    };

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    res.json({
      success: true,
      message: `Payment status updated to ${paymentStatus}`,
      data: updatedBooking
    });
  } catch (error) {
    console.error('Update payment error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error updating payment status',
      error: error.message
    });
  }
});

// ============= UPDATE CAR IMAGE =============
// PATCH /api/bookings/:id/car-image - Update only car image
router.patch('/:id/car-image', 
  authMiddleware, 
  upload.single('carimage'), 
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Car image is required'
        });
      }

      const booking = await Booking.findById(req.params.id);
      if (!booking) {
        await deleteFromS3(req.file.key);
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Delete old car image
      if (booking.carimage?.key) {
        await deleteFromS3(booking.carimage.key).catch(err => 
          console.error('Error deleting old car image:', err)
        );
      }

      // Update with new car image
      booking.carimage = {
        key: req.file.key,
        url: getS3Url(req.file.key),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      };

      await booking.save();

      res.json({
        success: true,
        message: 'Car image updated successfully',
        data: {
          carimage: booking.carimage
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
          message: 'Invalid booking ID format'
        });
      }
      res.status(500).json({
        success: false,
        message: 'Error updating car image',
        error: error.message
      });
    }
});

// ============= DELETE BOOKING =============
// DELETE /api/bookings/:id - Delete booking and associated files
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Delete associated files from S3
    if (booking.carimage?.key) {
      await deleteFromS3(booking.carimage.key);
    }
    if (booking.specialRequestAudio?.key) {
      await deleteFromS3(booking.specialRequestAudio.key);
    }

    await Booking.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Booking deleted successfully'
    });
  } catch (error) {
    console.error('Delete booking error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error deleting booking',
      error: error.message
    });
  }
});

// ============= GET BOOKING CAR IMAGE =============
// GET /api/bookings/:id/car-image - Get car image URL
router.get('/:id/car-image', authMiddleware, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).select('carimage');
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (!booking.carimage) {
      return res.status(404).json({
        success: false,
        message: 'Car image not found'
      });
    }

    res.json({
      success: true,
      data: booking.carimage
    });
  } catch (error) {
    console.error('Fetch car image error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error fetching car image',
      error: error.message
    });
  }
});

module.exports = router;
