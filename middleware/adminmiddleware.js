const jwt = require('jsonwebtoken');

// Store refresh tokens (in production, use Redis or database)
let refreshTokens = new Set();

// Generate refresh token (new function)
const generateRefreshToken = (user) => {
  const refreshToken = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
  refreshTokens.add(refreshToken);
  return refreshToken;
};

// Verify refresh token middleware (new function)
const authenticateRefreshToken = (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  // Check if refresh token exists in storage
  if (!refreshTokens.has(refreshToken)) {
    return res.status(403).json({ error: 'Invalid refresh token' });
  }

  jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, (err, user) => {
    if (err) {
      // Remove invalid refresh token
      refreshTokens.delete(refreshToken);
      return res.status(403).json({ error: 'Invalid or expired refresh token' });
    }
    
    // Remove old refresh token from storage
    refreshTokens.delete(refreshToken);
    
    req.user = user;
    req.refreshToken = refreshToken;
    next();
  });
};

// Generate new access token from refresh token (new function)
const refreshAccessToken = (req, res) => {
  const user = req.user;
  const oldRefreshToken = req.refreshToken;
  
  try{

  // Generate new access token
  const newAccessToken = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
  
  // Generate new refresh token
  const newRefreshToken = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
  
  // Remove old refresh token and add new one
  refreshTokens.delete(oldRefreshToken);
  refreshTokens.add(newRefreshToken);
  
  return res.json({
    "success": true,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken
  });
      
  }catch(err){
    return res.status(500).json({
       success: false,
      error: 'Failed to refresh token' });
  }
};

// Logout - remove refresh token (new function)
const logout = (req, res) => {
  const { refreshToken } = req.body;
  
  if (refreshToken) {
    refreshTokens.delete(refreshToken);
  }
  
  return res.json({ message: 'Logged out successfully' });
};

// Cleanup expired refresh tokens (helper function)
const cleanupRefreshTokens = () => {
  const now = Date.now() / 1000;
  for (const token of refreshTokens) {
    try {
      const decoded = jwt.decode(token);
      if (decoded.exp < now) {
        refreshTokens.delete(token);
      }
    } catch (err) {
      refreshTokens.delete(token);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupRefreshTokens, 60 * 60 * 1000);

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log();
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Middleware to check if user has admin role
const authorizeAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Middleware to check specific roles
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: `Access denied. Required roles: ${roles.join(', ')}` 
      });
    }
    next();
  };
};

// Middleware to allow all authenticated users (any role)
const authorizeAny = (req, res, next) => {
  // All authenticated users can access
  next();
};

module.exports = {
  authenticateToken,
  authorizeAdmin,
  authorizeRoles,
  authorizeAny,
  // New refresh token functions
  generateRefreshToken,
  authenticateRefreshToken,
  refreshAccessToken,
  logout,
  refreshTokens // Export for testing or management
};