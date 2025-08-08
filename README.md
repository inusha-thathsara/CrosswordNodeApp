# CrosswordNodeApp

A web-based crossword puzzle generator and solver built with Node.js, Express, and Python. The app dynamically generates crossword puzzles using a Python backend and provides an interactive web interface for users to solve them.

## Features
- Generates random crossword puzzles with clues and answers
- Interactive 10x10 crossword grid in the browser
- Real-time answer checking and scoring
- Hints and clues displayed for each puzzle
- Modern, responsive UI

## Demo
Run the app locally and visit [http://localhost:3000](http://localhost:3000) in your browser.

## Getting Started

### Prerequisites
- Node.js (v14 or higher recommended)
- Python 3.x

### Installation
1. Clone this repository:
   ```sh
   git clone https://github.com/inusha-thathsara/CrosswordNodeApp.git
   cd CrosswordNodeApp
   ```
2. Install Node.js dependencies:
   ```sh
   npm install
   ```
3. Ensure Python is installed and available in your PATH.

### Running the App
Start the server with:
```sh
node app.js
```
Then open your browser and go to [http://localhost:3000](http://localhost:3000).

## Project Structure
```
├── app.js              # Node.js/Express server
├── crossWord.py        # Python script for crossword generation
├── package.json        # Node.js dependencies
├── public/
│   ├── index.html      # Main web interface
│   └── style.css       # Stylesheet
```

## How It Works
- The Node.js server (`app.js`) serves the static frontend and exposes an API endpoint `/data`.
- When the frontend loads, it fetches crossword data from `/data`, which runs the Python script (`crossWord.py`) to generate a new puzzle and clues.
- The frontend displays the puzzle grid and clues, allowing users to fill in answers and check their score.

## Contributing
Contributions are welcome! To contribute:
1. Fork the repository
2. Create a new branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a pull request

## License
This project is licensed under the MIT License.

## Author
- [inusha-thathsara](https://github.com/inusha-thathsara)
