import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT = 20; // requests per minute
const RATE_WINDOW = 60000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const userRequests = rateLimitMap.get(ip) || [];
  const recentRequests = userRequests.filter(time => now - time < RATE_WINDOW);
  
  if (recentRequests.length >= RATE_LIMIT) {
    return false;
  }
  
  recentRequests.push(now);
  rateLimitMap.set(ip, recentRequests);
  return true;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Chat endpoint - OpenAI
app.post('/api/chat', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  // Rate limiting
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ 
      error: 'Too many requests. Please try again later.' 
    });
  }

  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid message format' });
    }

    if (message.length > 4000) {
      return res.status(400).json({ error: 'Message too long' });
    }

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are Nexus, a helpful research assistant. Provide clear, accurate, and concise answers. When writing code, wrap it in \`\`\`javascript code blocks.`
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      return res.status(response.status).json({ 
        error: errorData.error?.message || 'OpenAI API error' 
      });
    }

    const data = await response.json();
    const textContent = data.choices?.[0]?.message?.content || 'No response from AI';

    res.json({
      success: true,
      content: textContent,
      model: data.model,
      usage: data.usage
    });

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Web search endpoint (using Serper API as an example)
app.post('/api/search', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ 
      error: 'Too many requests. Please try again later.' 
    });
  }

  try {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Invalid query format' });
    }

    // Example with Serper API (you'll need to sign up at serper.dev)
    if (process.env.SERPER_API_KEY) {
      const response = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: query })
      });

      const data = await response.json();
      res.json({
        success: true,
        results: data.organic || []
      });
    } else {
      res.status(501).json({ 
        error: 'Search API not configured. Add SERPER_API_KEY to .env' 
      });
    }

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Search failed',
      message: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Nexus backend server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`💬 Chat endpoint: http://localhost:${PORT}/api/chat`);
  console.log(`🔍 Search endpoint: http://localhost:${PORT}/api/search`);
  
  // Warn about missing API keys
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  Warning: OPENAI_API_KEY not set in .env file');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  app.close(() => {
    console.log('HTTP server closed');
  });
});