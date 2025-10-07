# Battleship Game Logic

This directory contains the Rust implementation of the battleship game logic using the Calimero SDK.

## Architecture

The codebase is organized using Domain-Driven Design (DDD) principles with the following modules:

- **`board.rs`** - Board representation, coordinates, and cell types
- **`ships.rs`** - Ship definitions, fleet management, and ship validation
- **`players.rs`** - Player management and private board logic
- **`game.rs`** - Core game logic and match management
- **`events.rs`** - Game events and state changes
- **`validation.rs`** - Comprehensive validation strategy pattern implementation

## Key Features

### Validation Strategy Pattern
The validation system uses a sophisticated Strategy Pattern implementation that provides:

- **Extensibility**: Easy to add new validation rules
- **Composability**: Mix and match validation strategies
- **Testability**: Each strategy can be tested independently
- **Maintainability**: Validation logic is organized and separated

For detailed documentation on the validation system, see the [validation module documentation](src/validation.rs) or run:

```bash
cargo doc --open
```

## Building

```bash
./build.sh
```

This will compile the Rust code to WebAssembly for use with the Calimero SDK.

## Documentation

To generate and view the complete API documentation:

```bash
cargo doc --open
```

The documentation includes comprehensive examples and usage patterns for all modules.
