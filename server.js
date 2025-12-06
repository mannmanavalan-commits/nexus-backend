import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

const rateLimitMap = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW = 60000;

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/chat', async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
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
            content: 'You are Nexus, a helpful research assistant. Provide clear, accurate, and concise answers. When writing code, wrap it in ```javascript code blocks.'
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
        success: false,
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
      success: false,
      error: 'Internal server error',
      message: error.message 
    });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Nexus backend server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`💬 Chat endpoint: http://localhost:${PORT}/api/chat`);
  
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  Warning: OPENAI_API_KEY not set in environment variables');
  }
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});
