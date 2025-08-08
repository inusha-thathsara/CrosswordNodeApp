Crossword Puzzle Generator

A web-based crossword puzzle generator built using Node.js, Express.js, and Python. The program generates a 10x10 grid crossword puzzle with random words and clues. The puzzle is filled with words from a predefined list, and the words are chosen based on their length and frequency of appearance.

Features:

* Generates a 10x10 grid crossword puzzle with random words and clues
* Uses a predefined list of words and clues
* Words are chosen based on their length and frequency of appearance
* Puzzle is filled with words in a way that minimizes empty spaces
* User can submit their answers and check their score
* Hints are provided for each word in the puzzle

Technologies Used:

* Node.js
* Express.js
* Python
* HTML
* CSS
* JavaScript

How it Works:

1. The program uses a Python script to generate the crossword puzzle grid and fill it with words from a predefined list.
2. The grid is then sent to the Node.js server, which serves it to the client as a JSON object.
3. The client-side JavaScript code uses the JSON object to populate the crossword puzzle grid on the webpage.
4. The user can submit their answers and check their score by clicking the "Submit" button.
5. The program checks the user's answers against the correct answers and displays the score.

Files:

* `app.js`: Node.js server code
* `crossWord.py`: Python script to generate crossword puzzle grid
* `index.html`: Client-side HTML code
* `style.css`: Client-side CSS code
* `package.json`: Node.js dependencies and scripts


This crossword puzzle generator generates a crossword puzzle with 10x10 grid size. 
The puzzle is filled with random words and clues. 
The words are chosen from a predefined list from crossWord.py file.
Change the word_list_raw variable in crossWord.py to change the list of words and clues.

Server running on http://localhost:3000

Contact Us
	gmail: inusha.thathsara@gmail.com
	linkedin: www.linkedin.com/in/inusha-gunasekara-9996632a5
