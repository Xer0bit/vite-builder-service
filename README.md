# Server-Side Vite Builder

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](https://www.docker.com/)

A powerful open-source server-side build service for Vite applications. Submit your project files as JSON, and get back a production-ready build (HTML, CSS, JS) as a ZIP file. Perfect for creating live previews of Vite apps without local setup, similar to tools used by [Lovable](https://lovable.dev), [0dev](https://0dev.app), and other no-code/low-code platforms.

## 🚀 Features

- **Server-Side Building**: Build Vite projects remotely without installing dependencies locally
- **JSON API**: Submit project files as JSON payload with paths and contents
- **Dependency Caching**: Intelligent caching of `node_modules` to speed up builds
- **Queue System**: Asynchronous job processing with Redis-backed queue
- **Admin Interface**: Web UI for managing builds, cache, and API keys
- **API Key Management**: Secure authentication with revocable API keys
- **Docker Ready**: Easy deployment with Docker Compose
- **Extensible**: Support for custom build commands and configurations
- **Real-time Logs**: Live streaming of build logs via Server-Sent Events

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Admin Interface](#admin-interface)
- [Configuration](#configuration)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## 🚀 Quick Start

### Using Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/Xer0bit/vite-builder-service.git
cd vite-builder-service

# Start the service
docker compose up -d

# Access admin interface
open http://localhost:3000/admin
```

### Manual Installation

```bash
# Install dependencies
npm install

# Start Redis (required for queue)
redis-server &

# Start the service
npm start

# Access admin interface
open http://localhost:3000/admin
```

## 📦 Installation

### Prerequisites

- Node.js 18+
- Redis (for job queue)
- SQLite3 development headers (for better-sqlite3)

### With Docker

```bash
# Clone and start
git clone https://github.com/Xer0bit/vite-builder-service.git
cd vite-builder-service
docker compose up -d
```

### Without Docker

#### Linux (Ubuntu/Debian)

```bash
# Install system dependencies
sudo apt update
sudo apt install -y build-essential python3 libsqlite3-dev redis-server

# Start Redis
sudo systemctl enable --now redis

# Install Node.js dependencies
npm install

# Start the service
npm start
```

#### macOS

```bash
# Install dependencies with Homebrew
brew install sqlite3 redis curl jq
brew services start redis

# Install Node.js dependencies
npm install

# Start the service
npm start
```

#### Windows

```bash
# Install Redis (via Chocolatey or download)
choco install redis-64
redis-server

# Install Node.js dependencies
npm install

# Start the service
npm start
```

## 💡 Usage

### Basic API Usage

Send a POST request to `/build` with your project files:

```bash
curl -X POST http://localhost:3000/build \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "files": [
      {
        "path": "package.json",
        "content": "{\"name\":\"my-app\",\"scripts\":{\"build\":\"vite build\"}}"
      },
      {
        "path": "index.html",
        "content": "<!DOCTYPE html><html><body><h1>Hello Vite!</h1></body></html>"
      }
    ]
  }'
```

### Using the Sample Client

```bash
# Navigate to client directory
cd client

# Install dependencies
npm install

# Send a sample build
API_KEY=your_api_key_here npm run send
```

### JavaScript Example

```javascript
const response = await fetch('http://localhost:3000/build', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your-api-key'
  },
  body: JSON.stringify({
    files: [
      {
        path: 'package.json',
        content: JSON.stringify({
          name: 'my-vite-app',
          scripts: { build: 'vite build' },
          devDependencies: { vite: '^5.0.0' }
        })
      },
      {
        path: 'index.html',
        content: '<!DOCTYPE html><html><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>'
      },
      {
        path: 'src/main.js',
        content: 'document.getElementById("app").innerText = "Hello from server-side build!";'
      }
    ]
  })
});

const buildData = await response.json();
console.log('Build ID:', buildData.id);
console.log('Status URL:', buildData.statusUrl);
```

## 📚 API Reference

### Authentication

All build endpoints require authentication via API key:

- Header: `x-api-key: YOUR_API_KEY`
- Query parameter: `?apiKey=YOUR_API_KEY`

API keys are managed through the admin interface.

### Endpoints

#### POST /build

Submit a new build job.

**Request Body:**
```json
{
  "files": [
    {
      "path": "string (required)",
      "content": "string (optional)",
      "contentBase64": "string (optional)"
    }
  ],
  "installDependencies": true,
  "buildCommand": "npm run build",
  "waitForCompletion": false
}
```

**Response (202 Accepted):**
```json
{
  "id": "uuid",
  "status": "queued",
  "statusUrl": "/api/builds/{id}/status",
  "logsUrl": "/api/builds/{id}/logs",
  "message": "Build queued successfully"
}
```

#### GET /api/builds/:id/status

Get build status and metadata.

**Response:**
```json
{
  "id": "uuid",
  "status": "completed|failed|building|installing|queued",
  "createdAt": "2025-11-18T10:00:00.000Z",
  "completedAt": "2025-11-18T10:05:00.000Z",
  "logs": "Build output...",
  "artifact": "/builds/{id}.zip",
  "buildCommand": "npm run build"
}
```

#### GET /api/builds/:id/logs

Get build logs.

**Response:**
```json
{
  "logs": "Detailed build logs...",
  "status": "completed"
}
```

#### GET /api/builds/:id/download

Download the built artifact (ZIP file).

**Response:** Binary ZIP file

#### GET /api/builds

List builds (paginated).

**Query Parameters:**
- `limit`: Number of builds to return (default: 10, max: 100)
- `offset`: Offset for pagination (default: 0)

**Response:**
```json
{
  "builds": [
    {
      "id": "uuid",
      "status": "completed",
      "createdAt": "2025-11-18T10:00:00.000Z",
      "completedAt": "2025-11-18T10:05:00.000Z",
      "artifact": "/builds/{id}.zip"
    }
  ],
  "total": 25,
  "limit": 10,
  "offset": 0
}
```

#### GET /api/docs

Get API documentation.

## 🛠️ Admin Interface

Access the admin interface at `http://localhost:3000/admin`.

### Features

- **Build Management**: View all builds, their status, and logs
- **Cache Management**: Monitor and manage dependency cache
- **API Key Management**: Create, revoke, and manage API keys
- **Metrics Dashboard**: View system metrics and job queue status
- **Configuration**: View server configuration and settings

### Admin Authentication

The admin interface requires an admin key, which is:
1. Set via `ADMIN_KEY` environment variable
2. Auto-generated on first startup and saved to `data/admin.json`

### Admin API Endpoints

All admin endpoints require `x-admin-key` header.

- `GET /admin/builds` - List all builds
- `GET /admin/builds/:id` - Get build details and logs
- `GET /admin/cache` - View cache status
- `POST /admin/cache/clear` - Clear entire cache
- `POST /admin/cache/settings` - Update cache settings
- `GET /admin/metrics` - Get system metrics
- `GET /admin/config` - View server configuration
- `GET /admin/api/keys` - List API keys
- `POST /admin/api/keys` - Create new API key
- `DELETE /admin/api/keys/:id` - Revoke API key

## ⚙️ Configuration

### Environment Variables

- `PORT`: Server port (default: 3000)
- `ADMIN_KEY`: Admin authentication key
- `REDIS_URL`: Redis connection URL (default: redis://127.0.0.1:6379)
- `DATA_DIR`: Directory for persistent data (default: ./data)
- `BUILDS_DIR`: Directory for build artifacts (default: ./data/builds)
- `CACHE_DIR`: Directory for dependency cache (default: ./data/cache)
- `BUILD_TIMEOUT_MS`: Build timeout in milliseconds (default: 300000)
- `INSTALL_TIMEOUT_MS`: Install timeout in milliseconds (default: 120000)

### Cache Configuration

Cache settings can be modified via admin interface or by editing `data/cache_config.json`:

```json
{
  "maxEntries": 5,
  "maxBytes": 2147483648
}
```

## 🛠️ Development

### Project Structure

```
├── server/
│   ├── index.js          # Main server file
│   ├── config.js         # Configuration
│   ├── worker.js         # Build worker
│   └── admin/            # Admin UI files
├── client/               # Sample client
├── data/                 # Persistent data (builds, cache, keys)
├── docker-compose.yml    # Docker setup
├── Dockerfile            # Docker image
└── package.json
```

### Development Setup

```bash
# Install dependencies
npm install

# Start Redis
redis-server

# Start development server with auto-reload
npm run dev

# Run tests
npm test
```

### Adding New Features

1. Server endpoints go in `server/index.js`
2. Admin UI components in `server/admin/`
3. Client examples in `client/`
4. Update API documentation in `/api/docs` endpoint

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes and add tests
4. Run the linter: `npm run lint`
5. Submit a pull request

### Guidelines

- Follow existing code style
- Add tests for new features
- Update documentation
- Ensure Docker builds work
- Test with both Docker and local setups

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Express.js](https://expressjs.com/)
- Job queue powered by [Bull](https://github.com/OptimalBits/bull) and [Redis](https://redis.io/)
- Database: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- Inspired by modern no-code platforms like [Lovable](https://lovable.dev) and [0dev](https://0dev.app)

## 📞 Support

- Issues: [GitHub Issues](https://github.com/Xer0bit/server-side-vite-builder/issues)
- Discussions: [GitHub Discussions](https://github.com/Xer0bit/server-side-vite-builder/discussions)

---

**Created by [@xer0bit](https://github.com/Xer0bit)**
