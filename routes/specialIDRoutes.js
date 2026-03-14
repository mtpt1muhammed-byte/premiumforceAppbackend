const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const SpecialContent = require('../models/specialIDModel');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');


// ============= CREATE =============
// POST /api/special-content
router.post('/', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { text, isActive } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        message: 'Text is required'
      });
    }

    const content = new SpecialContent({
      text: text.trim(),
      isActive: isActive !== undefined ? isActive : true
    });

    await content.save();

    res.status(201).json({
      success: true,
      message: 'Special content created',
      data: content
    });

  } catch (error) {
    console.error('Create error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating content',
      error: error.message
    });
  }
});

// ============= GET ALL =============
// GET /api/special-content
router.get('/', async (req, res) => {
  try {
    const { isActive, page = 1, limit = 10 } = req.query;

    const query = {};
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const contents = await SpecialContent.find(query)
      .sort({ specialID: 1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await SpecialContent.countDocuments(query);

    res.json({
      success: true,
      count: contents.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: contents
    });

  } catch (error) {
    console.error('Get all error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching contents',
      error: error.message
    });
  }
});

// ============= GET ACTIVE (Public) =============
// GET /api/special-content/active
router.get('/active', async (req, res) => {
  try {
    const contents = await SpecialContent.find({ isActive: true })
      .sort({ specialID: 1 });

    res.json({
      success: true,
      count: contents.length,
      data: contents
    });

  } catch (error) {
    console.error('Get active error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching active contents',
      error: error.message
    });
  }
});

// ============= GET BY ID =============
// GET /api/special-content/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    const content = await SpecialContent.findById(id);

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    res.json({
      success: true,
      data: content
    });

  } catch (error) {
    console.error('Get by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching content',
      error: error.message
    });
  }
});

// ============= GET BY SPECIAL ID =============
// GET /api/special-content/special/:specialID
router.get('/special/:specialID', async (req, res) => {
  try {
    const { specialID } = req.params;

    const content = await SpecialContent.findOne({ specialID: parseInt(specialID) });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    res.json({
      success: true,
      data: content
    });

  } catch (error) {
    console.error('Get by specialID error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching content',
      error: error.message
    });
  }
});

// ============= UPDATE =============
// PUT /api/special-content/:id
router.put('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { text, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    const updateData = {};
    if (text) updateData.text = text.trim();
    if (isActive !== undefined) updateData.isActive = isActive;

    const content = await SpecialContent.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    res.json({
      success: true,
      message: 'Content updated',
      data: content
    });

  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating content',
      error: error.message
    });
  }
});

// ============= PATCH UPDATE =============
// PATCH /api/special-content/:id
router.patch('/:id',  async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    // Remove fields that shouldn't be updated
    delete updates._id;
    delete updates.specialID;
    delete updates.createdAt;

    if (updates.text) updates.text = updates.text.trim();

    const content = await SpecialContent.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    );

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    res.json({
      success: true,
      message: 'Content updated',
      data: content
    });

  } catch (error) {
    console.error('Patch error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating content',
      error: error.message
    });
  }
});

// ============= DELETE (Soft Delete) =============
// DELETE /api/special-content/:id
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    const content = await SpecialContent.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    res.json({
      success: true,
      message: 'Content deactivated successfully'
    });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting content',
      error: error.message
    });
  }
});

// ============= HARD DELETE (Admin only) =============
// DELETE /api/special-content/:id/hard
router.delete('/:id/hard', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    const content = await SpecialContent.findByIdAndDelete(id);

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    res.json({
      success: true,
      message: 'Content permanently deleted'
    });

  } catch (error) {
    console.error('Hard delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting content',
      error: error.message
    });
  }
});

// ============= TOGGLE STATUS =============
// PATCH /api/special-content/:id/toggle
router.patch('/:id/toggle', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    const content = await SpecialContent.findById(id);

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    content.isActive = !content.isActive;
    await content.save();

    res.json({
      success: true,
      message: `Content ${content.isActive ? 'activated' : 'deactivated'}`,
      data: {
        id: content._id,
        specialID: content.specialID,
        isActive: content.isActive
      }
    });

  } catch (error) {
    console.error('Toggle error:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling status',
      error: error.message
    });
  }
});

module.exports = router;