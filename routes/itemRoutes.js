// routes/items.js - CORRECTED CommonJS version
const express = require('express');
const Item = require('../models/item_model');

const router = express.Router();

// ============= CREATE =============
// POST /api/items - Create a new item
router.post('/', async (req, res) => {
  try {
    const { name, description, price, category, inStock } = req.body;
    
    // Validation
    if (!name || !description || !price) {
      return res.status(400).json({ 
        message: 'Please provide name, description and price' 
      });
    }

    const newItem = new Item({
      name,
      description,
      price,
      category: category || 'General',
      inStock: inStock !== undefined ? inStock : true
    });

    const savedItem = await newItem.save();
    res.status(201).json({
      message: 'Item created successfully',
      item: savedItem
    });
  } catch (error) {
    console.error('Create error:', error);
    res.status(500).json({ 
      message: 'Error creating item', 
      error: error.message 
    });
  }
});


/////////
// ============= READ ALL =============
// GET /api/items - Get all items
router.get('/', async (req, res) => {
  try {
    const { category, inStock, sort } = req.query;
    let query = {};
    
    // Filtering
    if (category) query.category = category;
    if (inStock) query.inStock = inStock === 'true';
    
    // Sorting
    let sortOption = {};
    if (sort === 'price_asc') sortOption.price = 1;
    else if (sort === 'price_desc') sortOption.price = -1;
    else if (sort === 'newest') sortOption.createdAt = -1;
    
    const items = await Item.find(query).sort(sortOption);
    res.status(200).json({
      count: items.length,
      items
    });
  } catch (error) {
    console.error('Fetch all error:', error);
    res.status(500).json({ 
      message: 'Error fetching items', 
      error: error.message 
    });
  }
});

// ============= READ SINGLE =============
// GET /api/items/:id - Get a single item by ID
router.get('/:id', async (req, res) => {
  try {
    const item = await Item.findById(req.params.id);
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }
    
    res.status(200).json(item);
  } catch (error) {
    console.error('Fetch single error:', error);
    // Check if error is due to invalid ID format
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid item ID format' });
    }
    res.status(500).json({ 
      message: 'Error fetching item', 
      error: error.message 
    });
  }
});

// ============= UPDATE =============
// PUT /api/items/:id - Update an item
router.put('/:id', async (req, res) => {
  try {
    const { name, description, price, category, inStock } = req.body;
    
    const updatedItem = await Item.findByIdAndUpdate(
      req.params.id,
      { name, description, price, category, inStock },
      { new: true, runValidators: true }
    );
    
    if (!updatedItem) {
      return res.status(404).json({ message: 'Item not found' });
    }
    
    res.status(200).json({
      message: 'Item updated successfully',
      item: updatedItem
    });
  } catch (error) {
    console.error('Update error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid item ID format' });
    }
    res.status(500).json({ 
      message: 'Error updating item', 
      error: error.message 
    });
  }
});

// ============= DELETE =============
// DELETE /api/items/:id - Delete an item
router.delete('/:id', async (req, res) => {
  try {
    const deletedItem = await Item.findByIdAndDelete(req.params.id);
    
    if (!deletedItem) {
      return res.status(404).json({ message: 'Item not found' });
    }
    
    res.status(200).json({ 
      message: 'Item deleted successfully' 
    });
  } catch (error) {
  -  console.error('Delete error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid item ID format' });
    }
    res.status(500).json({ 
      message: 'Error deleting item', 
      error: error.message 
    });
  }
});

module.exports = router;