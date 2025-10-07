# Battleship Game on Calimero

A complete implementation of the classic Battleship game built on the Calimero SDK, featuring a modern React frontend and a well-architected Rust backend with comprehensive documentation.

## 🎮 Game Features

- **Classic Battleship Gameplay**: 10x10 grid with standard ship fleet (1x5, 1x4, 2x3, 1x2)
- **Real-time Multiplayer**: Turn-based gameplay with shot proposals and acknowledgments
- **Private Ship Placement**: Ships are stored privately until hit
- **Modern UI**: Clean, intuitive React interface with integrated shot selection
- **Comprehensive Validation**: Strategy pattern-based validation system
- **Event-Driven Architecture**: Complete audit trail of all game actions

## 🏗️ Architecture

### Frontend (`app/`)
- **React + TypeScript**: Modern frontend with hooks and functional components
- **Calimero Integration**: Seamless connection to the Calimero blockchain
- **Responsive Design**: Clean, intuitive user interface
- **Real-time Updates**: Live game state synchronization

### Backend (`logic/`)
- **Rust + Calimero SDK**: High-performance blockchain-based game logic
- **Domain-Driven Design**: Well-organized modules with clear separation of concerns
- **Validation Strategy Pattern**: Extensible validation system
- **Comprehensive Documentation**: Full Rust documentation with examples

## 📁 Project Structure

```
battleship/
├── app/                    # React frontend
│   ├── src/
│   │   ├── pages/         # Game pages (home, login, match, play)
│   │   ├── features/      # Feature modules
│   │   └── api/           # Calimero API client
│   └── package.json
├── logic/                  # Rust backend
│   ├── src/
│   │   ├── board.rs       # Board and coordinate types
│   │   ├── ships.rs       # Ship and fleet management
│   │   ├── players.rs     # Player management and private boards
│   │   ├── game.rs        # Core game logic and match management
│   │   ├── events.rs      # Domain events
│   │   ├── validation.rs  # Validation strategy pattern
│   │   └── lib.rs         # Main application logic
│   └── Cargo.toml
├── data/                   # Calimero node data
└── scripts/               # Build and deployment scripts
```

## 🚀 Quick Start

### Prerequisites

- Node.js 16+ and npm/pnpm
- Rust 1.70+
- Calimero SDK
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd battleship
   ```

2. **Install frontend dependencies (via root scripts)**
   ```bash
   pnpm run app:install
   ```

3. **Build the backend (WASM)**
   ```bash
   pnpm run logic:build
   ```

4. **Start the development servers (frontend + WASM watcher)**
   ```bash
   pnpm run app:dev
   ```

## 🎯 Game Rules

### Ship Placement
- **Fleet Composition**: 1x5 (carrier), 1x4 (battleship), 2x3 (cruiser, submarine), 1x2 (destroyer)
- **Placement Rules**: Ships must be straight, contiguous, and non-adjacent
- **Coordinate Format**: "x1,y1;x2,y2;..." for ship coordinates

### Gameplay
- **Turn-based**: Players alternate taking shots
- **Shot Process**: Propose shot → Target acknowledges → Shot resolved
- **Win Condition**: First player to sink all opponent ships wins

## 🔧 Development

### Backend Development

The Rust backend follows Domain-Driven Design principles:

- **`board`**: Board representation and coordinate management
- **`ships`**: Ship definitions and fleet validation
- **`players`**: Player management and private data storage
- **`game`**: Core game logic and match management
- **`events`**: Domain events for decoupling
- **`validation`**: Strategy pattern-based validation system

#### Building and Testing

```bash
# Build WASM (release profile used by the app)
pnpm run logic:build

# Optional: clean build artifacts
pnpm run logic:clean

# Optional: continuously watch and sync WASM into app on changes
pnpm run logic:watch

# Generate ABI client for the frontend from the latest ABI
pnpm run app:generate-client

# Low-level Rust workflows (if you need them)
cd logic
cargo check          # Check for compilation errors
cargo test           # Run tests
cargo doc --open     # Generate and view documentation
```

### Frontend Development

The React frontend provides a modern, intuitive interface:

- **Integrated Shot Selection**: Click directly on the "Your Shots" board
- **Real-time Updates**: Live game state synchronization
- **Responsive Design**: Works on desktop and mobile devices
- **Error Handling**: Comprehensive error messages and validation

#### Development Commands

```bash
# Start the app + WASM res watcher together (recommended)
pnpm run app:dev

# Build production frontend
pnpm run app:build

# Preview the production build locally
pnpm run app:preview
```

## 📚 Documentation

### API Documentation

Generate comprehensive API documentation:

```bash
cd logic
cargo doc --open
```

### Code Documentation

- **Rust Documentation**: Complete API reference with examples
- **TypeScript Types**: Well-defined interfaces and types
- **README Files**: Module-specific documentation

## 🧪 Testing

### Backend Testing

```bash
cd logic
cargo test
```

### Frontend Testing

```bash
cd app
npm test
```

## 🚀 Deployment

### Calimero Deployment

1. **Bootstrap local Calimero network with workflow**
   ```bash
   pnpm run network:bootstrap
   ```

2. **Build the WASM**
   ```bash
   pnpm run logic:build
   ```

3. **Sync the built WASM into the app**
   ```bash
   pnpm run logic:sync
   ```

4. **Deploy to Calimero**
   - Follow Calimero deployment guidelines
   - Upload the generated WASM file (`logic/target/wasm32-unknown-unknown/app-release/kv_store.wasm`)
   - Configure the frontend to connect to your Calimero node

### Frontend Deployment

```bash
pnpm run app:build
# Deploy the app/dist (or app/build) directory to your hosting service
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Calimero SDK**: For providing the blockchain infrastructure
- **React Team**: For the excellent frontend framework
- **Rust Community**: For the amazing language and ecosystem

## 📞 Support

If you have any questions or need help:

1. Check the [documentation](logic/src/)
2. Open an [issue](https://github.com/your-username/battleship/issues)
3. Join our community discussions

---

**Happy Gaming! 🎮⚓**