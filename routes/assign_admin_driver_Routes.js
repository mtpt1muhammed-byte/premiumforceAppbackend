// routes/adminAssignDriverRoutes.js
const express = require('express');
const router = express.Router();
const AdminAssignDriver = require('../models/assign_admin_driver_model');
const Driver = require('../models/driver_model');
const Admin = require('../models/users_model');
const {   authenticateToken,
  authorizeAdmin,
  authorizeRoles,
  authorizeAny,
  // New refresh token functions
  generateRefreshToken,
  authenticateRefreshToken,
  refreshAccessToken, } = require('../middleware/adminmiddleware');

// @desc    Assign a driver to admin
// @route   POST /api/admin/assign-driver
// @access  Private (Admin only)

router.post('/assign-driver', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    console.log('========== ASSIGN DRIVER DEBUG ==========');
    console.log('1. Request body:', req.body);
    console.log('2. req.admin:', req.admin);
    console.log('3. req.user:', req.user);
    console.log('4. req.userType:', req.userType);
    
    const { driverID } = req.body;
    
    // Check if admin exists in request
    if (!req.user.userId) {
      console.log('5. ERROR: req.user is undefined or missing userId!');
      return res.status(401).json({
        success: false,
        message: 'Authentication failed - admin not found in request'
      });
    }

    console.log('6. Admin ID from token:', req.user.userId);
    console.log('7. Admin full object:', JSON.stringify(req.user, null, 2));

    const adminID = req.user.userId; // Use the ID from the user object

    // Validate required fields
    if (!driverID) {
      return res.status(400).json({
        success: false,
        message: 'Driver ID is required'
      });
    }

    // Check if driver exists
    console.log('8. Looking for driver with ID:', driverID);
    const driver = await Driver.findById(driverID);
    console.log('9. Driver found:', driver ? 'Yes' : 'No');
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Check if driver is already assigned
    console.log('10. Checking existing assignments for driver:', driverID);
    const existingAssignment = await AdminAssignDriver.findOne({
      driverID,
      status: 'active'
    });
    console.log('11. Existing assignment:', existingAssignment);

    if (existingAssignment) {
      return res.status(400).json({
        success: false,
        message: 'Driver is already assigned to an admin',
        data: {
          assignedTo: existingAssignment.adminID,
          assignedAt: existingAssignment.assignedAt
        }
      });
    }

    // Create new assignment
    console.log('12. Creating new assignment with adminID:', adminID);
    const assignment = new AdminAssignDriver({
      adminID: adminID.toString(), // Ensure it's a string
      driverID,
      status: 'active'
    });

    await assignment.save();
    console.log('13. Assignment saved:', assignment._id);

    // Populate driver and admin details
    await assignment.populate([
      { path: 'driverID', select: 'driverName phoneNumber email vehicleName' },
      { path: 'adminID', select: 'name email' }
    ]);

    console.log('14. Assignment populated successfully');
    console.log('========== END DEBUG ==========');

    res.status(201).json({
      success: true,
      message: 'Driver assigned successfully',
      data: assignment
    });

  } catch (error) {
    console.error('❌ Assign driver error:', error);
    res.status(500).json({
      success: false,
      message: 'Error assigning driver',
      error: error.message
    });
  }
});

// @desc    Get all assignments for an admin
// @route   GET /api/admin/assignments
// @access  Private (Admin only)
router.get('/assignments', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const adminID = req.admin._id;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { adminID };
    if (status) {
      query.status = status;
    }

    const assignments = await AdminAssignDriver.find(query)
      .populate('driverID', 'driverName phoneNumber email vehicleName vehicleImage')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await AdminAssignDriver.countDocuments(query);

    res.status(200).json({
      success: true,
      data: assignments,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching assignments',
      error: error.message
    });
  }
});

// @desc    Update assignment status
// @route   PUT /api/admin/assignments/:id
// @access  Private (Admin only)
router.put('/assignments/:id',authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const adminID = req.admin._id;

    const assignment = await AdminAssignDriver.findOne({
      _id: id,
      adminID
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    // Update fields
    if (status) assignment.status = status;
    if (notes !== undefined) assignment.notes = notes;

    await assignment.save();

    await assignment.populate([
      { path: 'driverID', select: 'driverName phoneNumber email' },
      { path: 'adminID', select: 'name email' }
    ]);

    res.status(200).json({
      success: true,
      message: 'Assignment updated successfully',
      data: assignment
    });

  } catch (error) {
    console.error('Update assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating assignment',
      error: error.message
    });
  }
});

// @desc    Unassign/remove driver
// @route   DELETE /api/admin/assignments/:id
// @access  Private (Admin only)
router.delete('/assignments/:id',authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminID = req.admin._id;

    const assignment = await AdminAssignDriver.findOneAndDelete({
      _id: id,
      adminID
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Driver unassigned successfully'
    });

  } catch (error) {
    console.error('Unassign driver error:', error);
    res.status(500).json({
      success: false,
      message: 'Error unassigning driver',
      error: error.message
    });
  }
});

// @desc    Get all unassigned drivers (available for assignment)
// @route   GET /api/admin/available-drivers
// @access  Private (Admin only)
router.get('/available-drivers', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    // Find all drivers that are not actively assigned
    const activeAssignments = await AdminAssignDriver.find({ 
      status: 'active' 
    }).distinct('driverID');

    const availableDrivers = await Driver.find({
      _id: { $nin: activeAssignments },
      isActive: true
    }).select('driverName phoneNumber email vehicleName vehicleImage');

    res.status(200).json({
      success: true,
      data: availableDrivers
    });

  } catch (error) {
    console.error('Get available drivers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available drivers',
      error: error.message
    });
  }
});



module.exports = router;