// routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const Booking = require('../models/booking_model');

const User = require('../models/users_model');
const authMiddleware = require('../middleware/authTheMiddle');

const {   authenticateToken,
  authorizeAdmin,
 } = require('../middleware/adminmiddleware');

// Import S3 configuration from your central config file (like in userRoutes)
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');

const NotificationService = require('../services/notificationService');


const { notifyUser, notifyUsers } = require('../fcm');






// ============= GET MONTHLY EARNINGS =============
// GET /api/bookings/earnings/monthly - Get monthly earnings (Admin/Driver)
router.get('/earnings/monthly', authenticateToken, async (req, res) => {
  try {
    const { year = new Date().getFullYear(), driverId } = req.query;
    const userId = req.user.id; // From auth middleware
    const userRole = req.user.role; // Assuming role is in token

    console.log('Fetching earnings for year:', year);
    console.log('User role:', userRole);
    console.log('User ID:', userId);

    // Build query based on user role
    let matchQuery = {};

    if (userRole === 'driver') {
      // Driver can only see their own earnings
      matchQuery.driverID = new mongoose.Types.ObjectId(userId);
    } else if (userRole === 'admin' && driverId) {
      // Admin can see specific driver's earnings if driverId provided
      matchQuery.driverID = new mongoose.Types.ObjectId(driverId);
    }
    // If admin without driverId, show all drivers' earnings

    // IMPORTANT: Include ALL booking statuses that represent completed/payment-ready trips
    // Don't filter by bookingStatus if you want to see all earnings
    // matchQuery.bookingStatus = { $in: ['completed', 'payment_completed', 'payment_pending', 'end'] };
    
    // Or remove status filter completely to see all bookings with charges
    // The charge field exists regardless of status

    // Create date range for the entire year based on createdAt
    const startDate = new Date(year, 0, 1); // January 1st
    const endDate = new Date(year, 11, 31, 23, 59, 59, 999); // December 31st

    // Use createdAt instead of updatedAt for original booking date
    matchQuery.createdAt = {
      $gte: startDate,
      $lte: endDate
    };

    console.log('Earnings query:', JSON.stringify(matchQuery, null, 2));

    // First, let's get all bookings for debugging
    const allBookings = await Booking.find(matchQuery).select('createdAt charge bookingStatus driverID');
    console.log(`Found ${allBookings.length} bookings for year ${year}`);
    console.log('Sample bookings:', allBookings.slice(0, 3));

    if (allBookings.length === 0) {
      // If no bookings found with createdAt, try with updatedAt as fallback
      console.log('No bookings found with createdAt, trying updatedAt...');
      const fallbackQuery = {
        ...matchQuery,
        updatedAt: matchQuery.createdAt
      };
      delete fallbackQuery.createdAt;
      
      const fallbackBookings = await Booking.find(fallbackQuery).select('updatedAt charge bookingStatus driverID');
      console.log(`Found ${fallbackBookings.length} bookings with updatedAt`);
      
      if (fallbackBookings.length > 0) {
        matchQuery = fallbackQuery;
      }
    }

    // Aggregation pipeline for monthly earnings
    const pipeline = [
      { $match: matchQuery },
      {
        $group: {
          _id: {
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" }
          },
          totalEarnings: { 
            $sum: { 
              $toDouble: {
                $cond: {
                  if: { $isNumber: "$charge" },
                  then: "$charge",
                  else: { $toDouble: "$charge" }
                }
              }
            } 
          },
          totalBookings: { $sum: 1 },
          averageCharge: { 
            $avg: { 
              $toDouble: {
                $cond: {
                  if: { $isNumber: "$charge" },
                  then: "$charge",
                  else: { $toDouble: "$charge" }
                }
              }
            } 
          },
          bookings: { $push: { 
            id: "$_id",
            charge: "$charge",
            date: "$createdAt",
            customerId: "$customerID",
            carName: "$carName",
            status: "$bookingStatus"
          }}
        }
      },
      { $sort: { "_id.month": 1 } }
    ];

    let monthlyData = await Booking.aggregate(pipeline);

    console.log('Monthly aggregated data:', monthlyData);

    // Format response with all months
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Initialize all months with zero values
    const formattedData = months.map((month, index) => {
      const monthNum = index + 1;
      const monthData = monthlyData.find(d => d._id?.month === monthNum);
      
      // Get actual bookings for this month from the database (for detailed view)
      const monthStart = new Date(year, monthNum - 1, 1);
      const monthEnd = new Date(year, monthNum, 0, 23, 59, 59, 999);
      
      return {
        month: month,
        monthNumber: monthNum,
        year: parseInt(year),
        totalEarnings: monthData?.totalEarnings || 0,
        totalBookings: monthData?.totalBookings || 0,
        averageCharge: monthData?.averageCharge || 0,
        hasData: !!monthData,
        // Include sample bookings if available
        sampleBookings: monthData?.bookings?.slice(0, 5) || []
      };
    });

    // Calculate totals
    const totals = {
      totalEarnings: formattedData.reduce((sum, m) => sum + m.totalEarnings, 0),
      totalBookings: formattedData.reduce((sum, m) => sum + m.totalBookings, 0),
      averageMonthlyEarnings: formattedData.reduce((sum, m) => sum + m.totalEarnings, 0) / 12,
      averageBookingValue: formattedData.reduce((sum, m) => sum + m.totalEarnings, 0) / 
                          (formattedData.reduce((sum, m) => sum + m.totalBookings, 0) || 1)
    };

    res.status(200).json({
      success: true,
      message: 'Monthly earnings fetched successfully',
      data: {
        year: parseInt(year),
        months: formattedData,
        summary: totals,
        currency: 'SAR',
        debug: {
          totalBookingsInDB: allBookings.length,
          queryUsed: matchQuery
        }
      }
    });

  } catch (error) {
    console.error('Monthly earnings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching monthly earnings',
      error: error.message
    });
  }
});





















// ============= GET EARNINGS FOR SPECIFIC MONTH =============
// GET /api/bookings/earnings/month/:month
router.get('/earnings/month/:month', authenticateToken, async (req, res) => {
  try {
    const { month } = req.params;
    const { year = new Date().getFullYear(), driverId } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Validate month
    const monthNum = parseInt(month);
    if (monthNum < 1 || monthNum > 12) {
      return res.status(400).json({
        success: false,
        message: 'Invalid month. Must be between 1-12'
      });
    }

    // Build query
    let matchQuery = {
      bookingStatus: { $in: ['completed', 'payment_completed'] },
      updatedAt: {
        $gte: new Date(year, monthNum - 1, 1),
        $lte: new Date(year, monthNum, 0, 23, 59, 59, 999)
      }
    };

    if (userRole === 'driver') {
      matchQuery.driverID = new mongoose.Types.ObjectId(userId);
    } else if (userRole === 'admin' && driverId) {
      matchQuery.driverID = new mongoose.Types.ObjectId(driverId);
    }

    // Get detailed bookings for the month
    const bookings = await Booking.find(matchQuery)
      .populate('customerID', 'username email phoneNumber')
      .populate('driverID', 'driverName phoneNumber vehicleName')
      .sort({ updatedAt: -1 });

    // Calculate statistics
    const stats = {
      totalEarnings: 0,
      totalBookings: bookings.length,
      averageCharge: 0,
      maxCharge: 0,
      minCharge: Infinity
    };

    bookings.forEach(booking => {
      const charge = parseFloat(booking.charge) || 0;
      stats.totalEarnings += charge;
      stats.maxCharge = Math.max(stats.maxCharge, charge);
      stats.minCharge = Math.min(stats.minCharge, charge);
    });

    stats.averageCharge = stats.totalBookings > 0 ? 
      stats.totalEarnings / stats.totalBookings : 0;
    stats.minCharge = stats.minCharge === Infinity ? 0 : stats.minCharge;

    res.status(200).json({
      success: true,
      message: 'Monthly details fetched successfully',
      data: {
        month: monthNum,
        year: parseInt(year),
        monthName: new Date(year, monthNum - 1).toLocaleString('default', { month: 'long' }),
        statistics: stats,
        bookings: bookings
      }
    });

  } catch (error) {
    console.error('Month earnings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching month earnings',
      error: error.message
    });
  }
});

// ============= GET EARNINGS WITH DATE RANGE =============
// GET /api/bookings/earnings/range?from=2024-01-01&to=2024-12-31
router.get('/earnings/range', authenticateToken, async (req, res) => {
  try {
    const { from, to, driverId } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message: 'Please provide from and to dates'
      });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    // Build query
    let matchQuery = {
      bookingStatus: { $in: ['completed', 'payment_completed'] },
      updatedAt: {
        $gte: fromDate,
        $lte: toDate
      }
    };

    if (userRole === 'driver') {
      matchQuery.driverID = new mongoose.Types.ObjectId(userId);
    } else if (userRole === 'admin' && driverId) {
      matchQuery.driverID = new mongoose.Types.ObjectId(driverId);
    }

    // Group by day
    const earnings = await Booking.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: {
            year: { $year: "$updatedAt" },
            month: { $month: "$updatedAt" },
            day: { $dayOfMonth: "$updatedAt" }
          },
          earnings: { $sum: { $toDouble: "$charge" } },
          bookings: { $sum: 1 },
          charges: { $push: "$charge" }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } }
    ]);

    // Calculate summary
    const summary = earnings.reduce((acc, day) => ({
      totalEarnings: acc.totalEarnings + day.earnings,
      totalBookings: acc.totalBookings + day.bookings,
      averageDailyEarnings: 0
    }), { totalEarnings: 0, totalBookings: 0 });

    summary.averageDailyEarnings = earnings.length > 0 ? 
      summary.totalEarnings / earnings.length : 0;

    res.status(200).json({
      success: true,
      message: 'Earnings fetched successfully',
      data: {
        from: fromDate,
        to: toDate,
        daily: earnings,
        summary: summary
      }
    });

  } catch (error) {
    console.error('Range earnings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching earnings by range',
      error: error.message
    });
  }
});


// ============= GET EARNINGS SUMMARY =============
// GET /api/bookings/earnings/summary
router.get('/earnings/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { driverId } = req.query;

    let matchQuery = {
      bookingStatus: { $in: ['completed', 'payment_completed'] }
    };

    if (userRole === 'driver') {
      matchQuery.driverID = new mongoose.Types.ObjectId(userId);
    } else if (userRole === 'admin' && driverId) {
      matchQuery.driverID = new mongoose.Types.ObjectId(driverId);
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Get various summaries
    const [
      totalEarnings,
      thisMonthEarnings,
      lastMonthEarnings,
      dailyAverage,
      bestDay,
      worstDay
    ] = await Promise.all([
      // Total all-time earnings
      Booking.aggregate([
        { $match: matchQuery },
        { $group: { _id: null, total: { $sum: { $toDouble: "$charge" } } } }
      ]),
      
      // This month earnings
      Booking.aggregate([
        { 
          $match: {
            ...matchQuery,
            updatedAt: {
              $gte: new Date(currentYear, currentMonth, 1),
              $lte: new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999)
            }
          }
        },
        { $group: { _id: null, total: { $sum: { $toDouble: "$charge" } } } }
      ]),
      
      // Last month earnings
      Booking.aggregate([
        { 
          $match: {
            ...matchQuery,
            updatedAt: {
              $gte: new Date(currentYear, currentMonth - 1, 1),
              $lte: new Date(currentYear, currentMonth, 0, 23, 59, 59, 999)
            }
          }
        },
        { $group: { _id: null, total: { $sum: { $toDouble: "$charge" } } } }
      ]),
      
      // Daily average
      Booking.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: {
              year: { $year: "$updatedAt" },
              month: { $month: "$updatedAt" },
              day: { $dayOfMonth: "$updatedAt" }
            },
            dailyTotal: { $sum: { $toDouble: "$charge" } }
          }
        },
        {
          $group: {
            _id: null,
            average: { $avg: "$dailyTotal" }
          }
        }
      ]),
      
      // Best day (highest earnings)
      Booking.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$updatedAt" } }
            },
            total: { $sum: { $toDouble: "$charge" } }
          }
        },
        { $sort: { total: -1 } },
        { $limit: 1 }
      ]),
      
      // Worst day (lowest earnings)
      Booking.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$updatedAt" } }
            },
            total: { $sum: { $toDouble: "$charge" } }
          }
        },
        { $sort: { total: 1 } },
        { $limit: 1 }
      ])
    ]);

    res.status(200).json({
      success: true,
      message: 'Earnings summary fetched successfully',
      data: {
        totalEarnings: totalEarnings[0]?.total || 0,
        thisMonthEarnings: thisMonthEarnings[0]?.total || 0,
        lastMonthEarnings: lastMonthEarnings[0]?.total || 0,
        dailyAverage: dailyAverage[0]?.average || 0,
        bestDay: bestDay[0] || { date: 'No data', total: 0 },
        worstDay: worstDay[0] || { date: 'No data', total: 0 },
        currency: 'SAR'
      }
    });

  } catch (error) {
    console.error('Earnings summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching earnings summary',
      error: error.message
    });
  }
});





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
        pickupLat, pickupLong,pickupAddress, dropOffLat, dropOffLong, dropOffAddress,
        carName, charge,
        carclass, carbrand, carmodel, specialRequestText,
        passengerCount, passengerNames, passengerMobile, distance,
        customerID, bookingStatus, driverID
      } = req.body;

      // Validation for required fields (driverID is NOT required)
      if (!category || !city || !arrival || !pickupLat || !pickupLong || 
          !dropOffLat || !dropOffLong || !dropOffAddress || !carclass || 
          !carbrand || !carmodel || !passengerCount || !passengerNames || 
          !pickupAddress||
          !passengerMobile || !distance || !customerID || !charge || !carName) {
        
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

      // FIXED: Handle driverID validation properly - allow null, undefined, or valid ObjectId
      // Check if driverID is provided and not null/undefined/empty string
      if (driverID !== undefined && driverID !== null && driverID !== '') {
        // Check if it's the string "null" and treat as null
        if (driverID === 'null' || driverID === 'undefined') {
          // Treat as null, don't validate
          console.log('driverID is string null/undefined, treating as null');
        } 
        // Check if it's a valid ObjectId
        else if (!mongoose.Types.ObjectId.isValid(driverID)) {
          if (req.files) {
            if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid driver ID format',
            receivedValue: driverID // This helps debug what was received
          });
        }
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

        console.log('Request body:', customerID);

        const userDetails = await User.findById(customerID).select('fcmToken').lean();

        console.log(userDetails.fcmToken);
        console.log(">>>>>>");
        console.log(userDetails.fcmToken);
        
        await notifyUser(
          customerID,
          '✅ Booking Confirmed',
          `${carName} You already have a booking scheduled for this date`,
          {
            type: 'booking_created',
            bookingId: existingBooking._id.toString(),
            status: 'confirmed',
            carName: carName
          }
        );

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

      // Create booking object - handle driverID properly
      const bookingData = {
        category: String(category).trim(),
        city: String(city).trim(),
        airport: airport ? String(airport).trim() : undefined,
        terminal: terminal ? String(terminal).trim() : undefined,
        flightNumber: flightNumber ? String(flightNumber).trim() : undefined,
        arrival: parsedDate,
        pickupLat: parseFloat(pickupLat),
        pickupLong: parseFloat(pickupLong),
        pickupAddress: String(pickupAddress).trim(),
        dropOffLat: parseFloat(dropOffLat),
        dropOffLong: parseFloat(dropOffLong),
        dropOffAddress: String(dropOffAddress).trim(),
        carName: String(carName).trim(),
        carclass: String(carclass).trim(),
        carbrand: String(carbrand).trim(),
        carmodel: String(carmodel).trim(),
        charge: String(charge).trim(),
        carimage: req.files && req.files.carimage && req.files.carimage.length > 0 ? {
          key: req.files.carimage[0].key,
          url: getS3Url(req.files.carimage[0].key),
          originalName: req.files.carimage[0].originalname,
          mimeType: req.files.carimage[0].mimetype,
          size: req.files.carimage[0].size
        } : null,
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

      // FIXED: Properly handle driverID - set to null if not provided or invalid
      if (driverID === undefined || driverID === null || driverID === '' || driverID === 'null' || driverID === 'undefined') {
        bookingData.driverID = null; // Explicitly set to null
        console.log('Setting driverID to null');
      } else if (mongoose.Types.ObjectId.isValid(driverID)) {
        bookingData.driverID = driverID;
        console.log('Setting driverID to:', driverID);
      }

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

      // Optional: Send notification to the customer that booking was created successfully
      await notifyUser(
        customerID,
        '✅ Booking Confirmed',
        `Your booking for ${carName} has been created successfully.`,
        {
          type: 'booking_created',
          status: 'confirmed',
          carName: carName
        }
      );

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
        pickupLat, pickupLong, pickupAddress, dropOffLat, dropOffLong, dropOffAddress,
        carName, charge, driverID,
        carclass, carbrand, carmodel, specialRequestText,
        passengerCount, passengerNames, passengerMobile, distance,
        bookingStatus, customerID
      } = req.body;

      // Helper function to check if value is null/undefined/empty
      const isValidValue = (value) => {
        return value !== undefined && value !== null && value !== '' && value !== 'null' && value !== 'undefined';
      };


      // Validate required fields (only if they are being updated)
      const requiredFields = [
        { name: 'category', value: category },
        { name: 'city', value: city },
        { name: 'arrival', value: arrival },
        { name: 'pickupLat', value: pickupLat },
        { name: 'pickupLong', value: pickupLong },
        { name: 'pickupAddress', value: pickupAddress },
        { name: 'dropOffLat', value: dropOffLat },
        { name: 'dropOffLong', value: dropOffLong },
        { name: 'dropOffAddress', value: dropOffAddress },
        { name: 'carclass', value: carclass },
        { name: 'carbrand', value: carbrand },
        { name: 'carmodel', value: carmodel },
        { name: 'passengerCount', value: passengerCount },
        { name: 'passengerNames', value: passengerNames },
        { name: 'passengerMobile', value: passengerMobile },
        { name: 'distance', value: distance },
        { name: 'charge', value: charge },
        { name: 'carName', value: carName }
      ];

      // Check if any required field is being sent with invalid value
      for (const field of requiredFields) {
        if (field.value !== undefined && !isValidValue(field.value)) {
          // Delete uploaded files if validation fails
          if (req.files) {
            if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
          }
          
          return res.status(400).json({
            success: false,
            message: `Invalid value for required field: ${field.name}`
          });
        }
      }

      // Validate customerID format if provided and valid
      if (isValidValue(customerID)) {
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
      }

      // Validate driverID format if provided and valid
      if (isValidValue(driverID)) {
        if (!mongoose.Types.ObjectId.isValid(driverID)) {
          if (req.files) {
            if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid driver ID format'
          });
        }
      }

      // Validate date if provided
      let parsedDate = existingBooking.arrival;
      if (isValidValue(arrival)) {
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
      if (isValidValue(passengerNames)) {
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

      // Helper function to clean field values
      const cleanFieldValue = (value, existingValue) => {
        if (!isValidValue(value)) {
          return existingValue;
        }
        return value;
      };

      // Helper function to clean string fields
      const cleanStringField = (value, existingValue) => {
        if (!isValidValue(value)) {
          return existingValue;
        }
        return String(value).trim();
      };

      // Helper function to clean number fields
      const cleanNumberField = (value, existingValue, parseFunc = parseFloat) => {
        if (!isValidValue(value)) {
          return existingValue;
        }
        return parseFunc(value);
      };

      // Prepare update data with proper null handling
      const updateData = {
        category: cleanStringField(category, existingBooking.category),
        city: cleanStringField(city, existingBooking.city),
        airport: cleanStringField(airport, existingBooking.airport),
        terminal: cleanStringField(terminal, existingBooking.terminal),
        flightNumber: cleanStringField(flightNumber, existingBooking.flightNumber),
        arrival: parsedDate,
        pickupLat: cleanNumberField(pickupLat, existingBooking.pickupLat, parseFloat),
        pickupLong: cleanNumberField(pickupLong, existingBooking.pickupLong, parseFloat),
        pickupAddress: cleanStringField(pickupAddress, existingBooking.pickupAddress),
        dropOffLat: cleanNumberField(dropOffLat, existingBooking.dropOffLat, parseFloat),
        dropOffLong: cleanNumberField(dropOffLong, existingBooking.dropOffLong, parseFloat),
        dropOffAddress: cleanStringField(dropOffAddress, existingBooking.dropOffAddress),
        carName: cleanStringField(carName, existingBooking.carName),
        carclass: cleanStringField(carclass, existingBooking.carclass),
        carbrand: cleanStringField(carbrand, existingBooking.carbrand),
        carmodel: cleanStringField(carmodel, existingBooking.carmodel),
        charge: cleanStringField(charge, existingBooking.charge),
        passengerCount: cleanNumberField(passengerCount, existingBooking.passengerCount, parseInt),
        passengerNames: parsedPassengerNames,
        passengerMobile: cleanStringField(passengerMobile, existingBooking.passengerMobile),
        distance: cleanStringField(distance, existingBooking.distance),
        bookingStatus: isValidValue(bookingStatus) ? String(bookingStatus).trim() : existingBooking.bookingStatus,
        // Special handling for driverID - can be null to unassign driver
        driverID: isValidValue(driverID) ? driverID : null, // This allows explicitly setting driverID to null
        customerID: isValidValue(customerID) ? customerID : existingBooking.customerID,
        updatedAt: new Date()
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
        if (isValidValue(specialRequestText)) {
          updateData.specialRequestText = String(specialRequestText).trim();
        } else {
          // If empty/blank is sent, set to null or remove
          updateData.specialRequestText = null;
        }
      }

      // Add to tracking timeline
      updateData.$push = { TrackingTimeLine: 'booking_updated' };

      console.log('Update data:', JSON.stringify(updateData, null, 2));

      // Update the booking
      const updatedBooking = await Booking.findByIdAndUpdate(
        bookingId,
        updateData,
        { new: true, runValidators: true } // Return updated document and run validators
      );

      // Get the customerID to use for notifications (use the updated one)
      const notificationCustomerId = updateData.customerID || existingBooking.customerID;

      // Send notifications based on booking status
      if (updatedBooking.bookingStatus === 'assigned' && updatedBooking.driverID) {
        await notifyUser(
          notificationCustomerId,
          '✅ Booking trip Assigned',
          `Your booking for ${updatedBooking.carName} has been assigned successfully.`,
          {
            type: 'booking_assigned',
            bookingId: updatedBooking._id.toString(),
            status: 'assigned',
            carName: updatedBooking.carName,
            driverId: updatedBooking.driverID
          }
        );
      }
      
      if (updatedBooking.bookingStatus === 'start_pickup') {
        await notifyUser(
          notificationCustomerId,
          '✅ Trip Pickup Started',
          `Your pickup for ${updatedBooking.carName} has started.`,
          {
            type: 'pickup_started',
            bookingId: updatedBooking._id.toString(),
            status: 'start_pickup',
            carName: updatedBooking.carName
          }
        );
      }

      if (updatedBooking.bookingStatus === 'ongoing') {
        await notifyUser(
          notificationCustomerId,
          '✅ Trip On the way',
          `You're on the way to your destination in ${updatedBooking.carName}.`,
          {
            type: 'trip_ongoing',
            bookingId: updatedBooking._id.toString(),
            status: 'ongoing',
            carName: updatedBooking.carName
          }
        );
      }

      if (updatedBooking.bookingStatus === 'end') {
        await notifyUser(
          notificationCustomerId,
          '✅ Destination Reached',
          `You have reached your destination in ${updatedBooking.carName}.`,
          {
            type: 'destination_reached',
            bookingId: updatedBooking._id.toString(),
            status: 'end',
            carName: updatedBooking.carName
          }
        );
      }
      
      if (updatedBooking.bookingStatus === 'payment_pending') {
        await notifyUser(
          notificationCustomerId,
          '✅ Payment Pending',
          `Driver is awaiting payment for ${updatedBooking.carName}.`,
          {
            type: 'payment_pending',
            bookingId: updatedBooking._id.toString(),
            status: 'payment_pending',
            carName: updatedBooking.carName
          }
        );
      }

      if (updatedBooking.bookingStatus === 'payment_completed') {
        await notifyUser(
          notificationCustomerId,
          '✅ Trip Completed',
          `Your trip with ${updatedBooking.carName} has been completed successfully.`,
          {
            type: 'trip_completed',
            bookingId: updatedBooking._id.toString(),
            status: 'payment_completed',
            carName: updatedBooking.carName
          }
        );
      }

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
  }
);









// router.put('/:id', 
//   authMiddleware, 
//   upload.fields([
//     { name: 'carimage', maxCount: 1 },
//     { name: 'specialRequestAudio', maxCount: 1 }
//   ]), 
//   async (req, res) => {
//     try {
//       console.log('Update booking - ID:', req.params.id);
//       console.log('Request body:', req.body);
//       console.log('Request files:', req.files);

//       const bookingId = req.params.id;

//       // Validate booking ID
//       if (!mongoose.Types.ObjectId.isValid(bookingId)) {
//         // Delete uploaded files if validation fails
//         if (req.files) {
//           if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
//           if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
//         }
//         return res.status(400).json({
//           success: false,
//           message: 'Invalid booking ID format'
//         });
//       }

//       // Check if booking exists
//       const existingBooking = await Booking.findById(bookingId);
//       if (!existingBooking) {
//         // Delete uploaded files if booking not found
//         if (req.files) {
//           if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
//           if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
//         }
//         return res.status(404).json({
//           success: false,
//           message: 'Booking not found'
//         });
//       }

//       // Extract fields from request body
//       const {
//         category, city, airport, terminal, flightNumber, arrival,
//         pickupLat, pickupLong, dropOffLat, dropOffLong, dropOffAddress,
//         carName, charge,
//         carclass, carbrand, carmodel, specialRequestText,
//         passengerCount, passengerNames, passengerMobile, distance,
//         bookingStatus, driverID
//       } = req.body;

//       // Validate required fields (optional for update - you might want to make some fields optional)
//       // You can adjust this validation based on which fields are required for update
//       if (!category || !city || !arrival || !pickupLat || !pickupLong || 
//           !dropOffLat || !dropOffLong || !dropOffAddress || !carclass || 
//           !carbrand || !carmodel || !passengerCount || !passengerNames || 
//           !passengerMobile || !distance || !charge || !carName || !driverID) {
        
//         // Delete uploaded files if validation fails
//         if (req.files) {
//           if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
//           if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
//         }
        
//         return res.status(400).json({
//           success: false,
//           message: 'Please provide all required fields'
//         });
//       }

//       // Validate date if provided
//       let parsedDate = existingBooking.arrival;
//       if (arrival) {
//         parsedDate = new Date(arrival);
//         if (isNaN(parsedDate.getTime())) {
//           if (req.files) {
//             if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
//             if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
//           }
//           return res.status(400).json({
//             success: false,
//             message: 'Invalid date format for arrival'
//           });
//         }
//       }

//       // Parse passengerNames
//       let parsedPassengerNames = existingBooking.passengerNames;
//       if (passengerNames) {
//         if (typeof passengerNames === 'string') {
//           try {
//             parsedPassengerNames = JSON.parse(passengerNames);
//           } catch {
//             parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
//           }
//         } else if (Array.isArray(passengerNames)) {
//           parsedPassengerNames = passengerNames;
//         } else {
//           parsedPassengerNames = [String(passengerNames)];
//         }
//       }

//       // Prepare update data
//       const updateData = {
//         category: category ? String(category).trim() : existingBooking.category,
//         city: city ? String(city).trim() : existingBooking.city,
//         airport: airport ? String(airport).trim() : existingBooking.airport,
//         terminal: terminal ? String(terminal).trim() : existingBooking.terminal,
//         flightNumber: flightNumber ? String(flightNumber).trim() : existingBooking.flightNumber,
//         arrival: parsedDate,
//         pickupLat: pickupLat ? parseFloat(pickupLat) : existingBooking.pickupLat,
//         pickupLong: pickupLong ? parseFloat(pickupLong) : existingBooking.pickupLong,
//         dropOffLat: dropOffLat ? parseFloat(dropOffLat) : existingBooking.dropOffLat,
//         dropOffLong: dropOffLong ? parseFloat(dropOffLong) : existingBooking.dropOffLong,
//         dropOffAddress: dropOffAddress ? String(dropOffAddress).trim() : existingBooking.dropOffAddress,
//         carName: carName ? String(carName).trim() : existingBooking.carName,
//         carclass: carclass ? String(carclass).trim() : existingBooking.carclass,
//         carbrand: carbrand ? String(carbrand).trim() : existingBooking.carbrand,
//         carmodel: carmodel ? String(carmodel).trim() : existingBooking.carmodel,
//         charge: charge ? String(charge).trim() : existingBooking.charge,
//         passengerCount: passengerCount ? parseInt(passengerCount) : existingBooking.passengerCount,
//         passengerNames: parsedPassengerNames,
//         passengerMobile: passengerMobile ? String(passengerMobile).trim() : existingBooking.passengerMobile,
//         distance: distance ? String(distance).trim() : existingBooking.distance,
//         bookingStatus: bookingStatus || existingBooking.bookingStatus,
//         driverID: driverID || existingBooking.driverID,
//         updatedAt: new Date() // Add timestamp for tracking
//       };

//       // Handle file updates
      
//       // 1. Handle car image update
//       if (req.files && req.files.carimage && req.files.carimage[0]) {
//         // Delete old car image from S3 if exists
//         if (existingBooking.carimage && existingBooking.carimage.key) {
//           await deleteFromS3(existingBooking.carimage.key).catch(console.error);
//         }
        
//         // Add new car image
//         updateData.carimage = {
//           key: req.files.carimage[0].key,
//           url: getS3Url(req.files.carimage[0].key),
//           originalName: req.files.carimage[0].originalname,
//           mimeType: req.files.carimage[0].mimetype,
//           size: req.files.carimage[0].size
//         };
//       }

//       // 2. Handle special request audio update
//       if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio[0]) {
//         // Delete old audio from S3 if exists
//         if (existingBooking.specialRequestAudio && existingBooking.specialRequestAudio.key) {
//           await deleteFromS3(existingBooking.specialRequestAudio.key).catch(console.error);
//         }
        
//         // Add new audio
//         updateData.specialRequestAudio = {
//           key: req.files.specialRequestAudio[0].key,
//           url: getS3Url(req.files.specialRequestAudio[0].key),
//           originalName: req.files.specialRequestAudio[0].originalname,
//           mimeType: req.files.specialRequestAudio[0].mimetype,
//           size: req.files.specialRequestAudio[0].size
//         };
//       }

//       // 3. Handle special request text update
//       if (specialRequestText !== undefined) {
//         if (specialRequestText && specialRequestText.trim() !== '') {
//           updateData.specialRequestText = String(specialRequestText).trim();
//         } else {
//           // If empty string is sent, remove the field
//           updateData.$unset = { specialRequestText: 1 };
//         }
//       }

//       // Add to tracking timeline
//       updateData.$push = { TrackingTimeLine: 'booking_updated' };

//       console.log('Update data:', updateData);

//       // Update the booking
//       const updatedBooking = await Booking.findByIdAndUpdate(
//         bookingId,
//         updateData,
//         { new: true, runValidators: true } // Return updated document and run validators
//       );

//       if (updatedBooking.bookingStatus === 'assigned') {
//          await notifyUser(
//         customerID,
//         '✅ Booking trip Assisgned',
//         `Your booking for ${carName} has been created successfully.`,
//         {
//           type: 'booking Assigned',
//           // bookingId: booking._id.toString(),
//           status: 'confirmed',
//           carName: carName
//         }
//       );
//     }
//     if (updatedBooking.bookingStatus === 'start_pickup') {
//          await notifyUser(
//         customerID,
//         '✅ Trip Pickup Started',
//         `Your booking for ${carName} has been created successfully.`,
//         {
//           type: 'booking Pickup Started',
//           // bookingId: booking._id.toString(),
//           status: 'Pickup Started',
//           carName: carName
//         }
//       );
//     }

//        if (updatedBooking.bookingStatus === 'ongoing') {
//          await notifyUser(
//         customerID,
//         '✅ Trip On the way to trip',
//         `Your booking for ${carName} has been created successfully.`,
//         {
//           type: 'booking On the way to trip',
//           // bookingId: booking._id.toString(),
//           status: 'On the way to trip',
//           carName: carName
//         }
//       );
//     }

//       if (updatedBooking.bookingStatus === 'end') {
//          await notifyUser(
//         customerID,
//         '✅ Trip Destination Reached',
//         `Your booking for ${carName} has been created successfully.`,
//         {
//           type: 'booking Destination Reached',
//           // bookingId: booking._id.toString(),
//           status: 'Destination Reached',
//           carName: carName
//         }
//       );
//     }
//        if (updatedBooking.bookingStatus === 'payment_pending') {

//          await notifyUser(
//         customerID,
//         '✅ Driver is awaiting Payment',
//         `Your booking for ${carName} has been created successfully.`,
//         {
//           type: 'Diver is awaiting Payment',
//           // bookingId: booking._id.toString(),
//           status: 'Diver is Waiting for Payment',
//           carName: carName
//         }
//       );
//     }


//     if (updatedBooking.bookingStatus === 'payment_completed') {

//          await notifyUser(
//         customerID,
//         '✅Trip  Completed',
//         `Your booking for ${carName} has been created successfully.`,
//         {
//           type: 'Trip Completed',
//           // bookingId: booking._id.toString(),
//           status: 'Completed Trip',
//           carName: carName
//         }
//       );
//     }


//       res.status(200).json({
//         success: true,
//         message: 'Booking updated successfully',
//         data: updatedBooking
//       });

//     } catch (error) {
//       console.error('Update booking error:', error);
      
//       // Delete newly uploaded files if error occurs
//       if (req.files) {
//         if (req.files.carimage) {
//           await deleteFromS3(req.files.carimage[0].key).catch(console.error);
//         }
//         if (req.files.specialRequestAudio) {
//           await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//         }
//       }

//       if (error.name === 'ValidationError') {
//         const errors = {};
//         for (let field in error.errors) {
//           errors[field] = error.errors[field].message;
//         }
//         return res.status(400).json({
//           success: false,
//           message: 'Validation error',
//           errors: errors
//         });
//       }

//       if (error.code === 11000) {
//         return res.status(400).json({
//           success: false,
//           message: 'Duplicate field value entered'
//         });
//       }

//       res.status(500).json({
//         success: false,
//         message: 'Error updating booking',
//         error: error.message
//       });
//     }
// });










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
router.get('/', authenticateToken,
  authorizeAdmin, async (req, res) => {
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
router.get('/:id',  authenticateToken,
  authorizeAdmin, async (req, res) => {
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


// GET /api/bookings/customer/:customerId - Get all bookings for a specific customer


router.get('/customer/:customerId', 
   authenticateToken,
  authorizeAdmin, async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status, page = 1, limit = 10, sort = '-createdAt' } = req.query;

    // Validate customer ID
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer ID format'
      });
    }

    // Build query
    const query = { customerID: customerId };
    
    // Add status filter if provided
    if (status) {
      query.bookingStatus = status;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get all bookings for the customer with full details
    const bookings = await Booking.find(query)
      .populate('customerID', 'username email phoneNumber profileImage')
      .populate('driverID', 'driverName phoneNumber vehicleName vehicleImage rating')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await Booking.countDocuments(query);

    res.status(200).json({
      success: true,
      message: 'Bookings fetched successfully',
      count: bookings.length,
      total: total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: bookings
    });

  } catch (error) {
    console.error('Get customer bookings error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer ID format'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error fetching customer bookings',
      error: error.message
    });
  }
});


// GET BOOKINGS BY DRIVER ID
router.get('/driver/:driverid', authenticateToken,
  authorizeAdmin, async (req, res) => {
  try {
    // FIXED: Use the correct parameter name from the route
    const { driverid } = req.params;  // Changed from driverID to driverid
    const { status, page = 1, limit = 10, sort = '-createdAt' } = req.query;

    console.log('Driver ID received:', driverid);
    
    // Validate driver ID

    if (!mongoose.Types.ObjectId.isValid(driverid)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID format',
        receivedId: driverid  // Helpful for debugging
      });
    }

    // Build query - FIXED: Use driverid in query
    const query = { driverID: driverid };  // The field in your schema might be driverId or driverID
    
    // Add status filter if provided
    if (status) {
      query.bookingStatus = status;
    }

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    console.log('Query:', query);

    // Get bookings for the driver with full details
    const bookings = await Booking.find(query)
      .populate('customerID', 'username email phoneNumber profileImage')
      .populate('driverID', 'driverName phoneNumber vehicleName vehicleImage rating')
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    // Get total count for pagination
    const total = await Booking.countDocuments(query);

    console.log(`Found ${bookings.length} bookings for driver ${driverid}`);

    res.status(200).json({
      success: true,
      message: bookings.length > 0 ? 'Bookings fetched successfully' : 'No bookings found for this driver',
      data: bookings,
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
    console.error('Get driver bookings error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID format',
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error fetching driver bookings',
      error: error.message
    });
  }
});


// ============= UPDATE BOOKING STATUS =============
// PATCH /api/bookings/:id/status - Update booking status
router.patch('/:id/status', authenticateToken,
  authorizeAdmin, async (req, res) => {
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
router.patch('/:id/rating',
    authenticateToken,
  authorizeAdmin, async (req, res) => {
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
router.patch('/:id/payment', authenticateToken,
  authorizeAdmin,async (req, res) => {
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
  authenticateToken,
  authorizeAdmin,
  upload.single('carimage'), 
  async (req, res) => {
    try {
      
      // if (!req.file) {
      //   return res.status(400).json({
      //     success: false,
      //     message: 'Car image is required'
      //   });
      // }

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
router.delete('/:id', authenticateToken,
  authorizeAdmin,async (req, res) => {
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
router.get('/:id/car-image', authenticateToken,
  authorizeAdmin, async (req, res) => {
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
