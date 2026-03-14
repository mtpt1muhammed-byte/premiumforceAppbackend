const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Category = require('../models/categoryModel');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');
const {   authenticateToken,
  authorizeAdmin,
 } = require('../middleware/adminmiddleware');

// ============= HELPER FUNCTIONS =============
const formatFileData = (file) => ({
  key: file.key,
  url: getS3Url(file.key),
  originalName: file.originalname,
  mimeType: file.mimetype,
  size: file.size
});

const cleanupUploadedFiles = async (files) => {
  if (!files) return;
  
  const deletePromises = [];
  
  if (files.image) {
    deletePromises.push(
      deleteFromS3(files.image[0].key).catch(err => 
        console.error('Error deleting category image:', err)
      )
    );
  }
  
  await Promise.all(deletePromises);
};

// ============= CREATE CATEGORY =============
// POST /api/categories - Create a new category (image optional)
router.post('/', 
  authenticateToken, 
  authorizeAdmin,
  upload.fields([{ name: 'image', maxCount: 1 }]), 
  async (req, res) => {
    try {
      const { 
        name, 
        isActive = true,
        description,
        priority = 0
      } = req.body;

      console.log('Create category - Body:', req.body);
      console.log('Create category - Files:', req.files);

      // Validate required fields
      if (!name) {
        await cleanupUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'Please provide category name'
        });
      }

      // Check if category name already exists (case insensitive)
      const existingCategory = await Category.findOne({ 
        name: name
      });
      
      if (existingCategory) {
        await cleanupUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'Category with this name already exists',
          field: 'name'
        });
      }

      // Prepare category data with explicit image set to null
      const categoryData = {
        name,
        isActive: isActive === 'true' || isActive === true,
        description: description || undefined,
        priority: parseInt(priority) || 0,
        createdBy: req.user.userId,
        image: null // Explicitly set to null
      };

      // Add image if uploaded (optional)
      if (req.files && req.files.image && req.files.image[0]) {
        console.log('Image uploaded:', req.files.image[0]);
        categoryData.image = formatFileData(req.files.image[0]);
      }

      // Create new category
      const newCategory = new Category(categoryData);
      const savedCategory = await newCategory.save();

      // Prepare response message
      const responseMessage = categoryData.image 
        ? 'Category created successfully with image'
        : 'Category created successfully (without image)';

      res.status(201).json({
        success: true,
        message: responseMessage,
        data: savedCategory.getPublicCategory()
      });

    } catch (error) {
      // Delete uploaded files if error occurs
      await cleanupUploadedFiles(req.files);

      console.error('Create category error:', error);

      // Handle duplicate key error
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'Category with this name already exists',
          field: 'name'
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
        message: 'Error creating category',
        error: error.message
      });
    }
  }
);




// ============= GET ALL CATEGORIES =============
// GET /api/categories - Get all categories with filtering
router.get('/', async (req, res) => {
  try {
    const { 
      isActive, 
      search,
      sort = 'priority',
      page = 1, 
      limit = 100 
    } = req.query;

    // Build query
    const query = {};
    
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const categories = await Category.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'username')
      .populate('updatedBy', 'username');
    
    const total = await Category.countDocuments(query);

    res.status(200).json({
      success: true,
      count: categories.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: categories.map(category => category.getPublicCategory())
    });

  } catch (error) {
    console.error('Fetch categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching categories',
      error: error.message
    });
  }
});

// ============= GET ACTIVE CATEGORIES (Public) =============
// GET /api/categories/active - Get all active categories
router.get('/active',authenticateToken,
  authorizeAdmin, async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const categories = await Category.find({ isActive: true })
      .sort({ priority: -1, name: 1 })
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      count: categories.length,
      data: categories.map(category => category.getPublicCategory())
    });

  } catch (error) {
    console.error('Fetch active categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching active categories',
      error: error.message
    });
  }
});

// ============= GET CATEGORY BY ID =============
// GET /api/categories/:id - Get single category
router.get('/:id',authenticateToken,
  authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID format'
      });
    }

    const category = await Category.findById(id)
      .populate('createdBy', 'username')
      .populate('updatedBy', 'username');

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.status(200).json({
      success: true,
      data: category.getPublicCategory()
    });

  } catch (error) {
    console.error('Fetch category error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching category',
      error: error.message
    });
  }
});

// ============= UPDATE CATEGORY =============
// PUT /api/categories/:id - Update category
router.put('/:id', 
  authenticateToken, 
  authorizeAdmin,
  upload.fields([{ name: 'image', maxCount: 1 }]), 
  async (req, res) => {
    try {
      const { id } = req.params;
      const { 
        name, 
        isActive,
        description,
        priority
      } = req.body;

      console.log('Update category - ID:', id);
      console.log('Update category - Body:', req.body);
      console.log('Update category - Files:', req.files);

      // Validate ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        await cleanupUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'Invalid category ID format'
        });
      }

      // Find category by ID
      const category = await Category.findById(id);
      
      if (!category) {
        await cleanupUploadedFiles(req.files);
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      // Check if category name already exists (if name is being changed)
      if (name && name.toLowerCase() !== category.name.toLowerCase()) {
        const existingCategoryByName = await Category.findOne({ 
          name: { $regex: new RegExp(`^${name}$`, 'i') },
          _id: { $ne: id } // Exclude current category
        });
        
        if (existingCategoryByName) {
          await cleanupUploadedFiles(req.files);
          return res.status(400).json({
            success: false,
            message: 'Category with this name already exists',
            field: 'name'
          });
        }
      }

      // Prepare update data
      const updateData = {
        updatedBy: req.user.userId
      };

      // Add fields to update if provided
      if (name) updateData.name = name;
      if (isActive !== undefined) updateData.isActive = isActive === 'true' || isActive === true;
      if (description !== undefined) updateData.description = description || undefined;
      if (priority !== undefined) updateData.priority = parseInt(priority);
      
      // Handle image upload
      if (req.files && req.files.image && req.files.image[0]) {
        console.log('New image uploaded:', req.files.image[0]);
        
        // Delete old image from S3 if exists
        if (category.image && category.image.key) {
          console.log('Deleting old image:', category.image.key);
          await deleteFromS3(category.image.key).catch(err => 
            console.error('Error deleting old image:', err)
          );
        }
        
        // Add new image data
        updateData.image = formatFileData(req.files.image[0]);
      }

      // Update category
      const updatedCategory = await Category.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true, runValidators: true }
      );

      res.status(200).json({
        success: true,
        message: updateData.image ? 'Category updated successfully with new image' : 'Category updated successfully',
        data: updatedCategory.getPublicCategory()
      });

    } catch (error) {
      // Delete newly uploaded files if error occurs
      await cleanupUploadedFiles(req.files);

      console.error('Update category error:', error);

      // Handle duplicate key error
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'Category with this name already exists',
          field: 'name'
        });
      }

      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid category ID format'
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
        message: 'Error updating category',
        error: error.message
      });
    }
  }
);

// ============= UPDATE CATEGORY STATUS ONLY =============
// PATCH /api/categories/:id/status - Update only category status
router.patch('/:id/status', 
  authenticateToken, 
  authorizeAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid category ID format'
        });
      }

      if (isActive === undefined) {
        return res.status(400).json({
          success: false,
          message: 'isActive field is required'
        });
      }

      const category = await Category.findByIdAndUpdate(
        id,
        {
          isActive: isActive === 'true' || isActive === true,
          updatedBy: req.user.userId
        },
        { new: true }
      );

      if (!category) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      res.status(200).json({
        success: true,
        message: `Category ${category.isActive ? 'activated' : 'deactivated'} successfully`,
        data: {
          id: category._id,
          name: category.name,
          isActive: category.isActive
        }
      });

    } catch (error) {
      console.error('Update category status error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating category status',
        error: error.message
      });
    }
  }
);

// ============= UPDATE CATEGORY IMAGE ONLY =============
// PATCH /api/categories/:id/image - Update only category image
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
          message: 'Image file is required'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(id)) {
        await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'Invalid category ID format'
        });
      }

      const category = await Category.findById(id);
      
      if (!category) {
        await deleteFromS3(req.file.key);
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      // Delete old image
      if (category.image && category.image.key) {
        await deleteFromS3(category.image.key).catch(err => 
          console.error('Error deleting old image:', err)
        );
      }

      // Update with new image
      category.image = formatFileData(req.file);
      category.updatedBy = req.user.userId;
      await category.save();

      res.status(200).json({
        success: true,
        message: 'Category image updated successfully',
        data: {
          image: category.image
        }
      });

    } catch (error) {
      if (req.file) {
        await deleteFromS3(req.file.key).catch(console.error);
      }
      
      console.error('Update category image error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating category image',
        error: error.message
      });
    }
  }
);

// ============= DELETE CATEGORY =============
// DELETE /api/categories/:id - Delete category
router.delete('/:id', 
  authenticateToken, 
  authorizeAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid category ID format'
        });
      }

      const category = await Category.findById(id);
      
      if (!category) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }

      // Delete image from S3
      if (category.image && category.image.key) {
        await deleteFromS3(category.image.key).catch(err => 
          console.error('Error deleting category image:', err)
        );
      }

      // Delete category
      await Category.findByIdAndDelete(id);

      res.status(200).json({
        success: true,
        message: 'Category deleted successfully'
      });

    } catch (error) {
      console.error('Delete category error:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting category',
        error: error.message
      });
    }
  }
);

// ============= BULK UPDATE CATEGORIES =============
// PATCH /api/categories/bulk/status - Bulk update category status
router.patch('/bulk/status', 
  authenticateToken, 
  authorizeAdmin,
  
  async (req, res) => {
    try {
      const { categoryIds, isActive } = req.body;

      if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please provide an array of category IDs'
        });
      }

      if (isActive === undefined) {
        return res.status(400).json({
          success: false,
          message: 'isActive field is required'
        });
      }

      const result = await Category.updateMany(
        { _id: { $in: categoryIds } },
        {
          isActive: isActive === 'true' || isActive === true,
          updatedBy: req.user.userId
        }
      );

      res.status(200).json({
        success: true,
        message: `${result.modifiedCount} categories updated successfully`,
        data: {
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount
        }
      });

    } catch (error) {
      console.error('Bulk update error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating categories',
        error: error.message
      });
    }
  }
);

module.exports = router;