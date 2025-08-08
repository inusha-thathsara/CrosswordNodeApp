const express = require('express');
const { spawn } = require('child_process');
const app = express();

// Serve static files from "public" folder
app.use(express.static('public'));

// Separate route to send Python script output as JSON
app.get('/data', (req, res) => {
  let output = '';
  const python = spawn('python', ['crossWord.py']);

  python.stdout.on('data', (data) => {
    output += data.toString();
    console.log(output)
    console.log("Done")
    var solution = output.substring(0, 218);
    var puzzle = output.substring(218, 440)
    console.log(puzzle)
    console.log('')
    console.log(solution);

    var answerArray = output.substring(0, 218)
    //var puzzle = output.substring(313, 625)
    //console.log(puzzle)
    //console.log(answerArray)

    const arr = answerArray.split("\r\n");  // Split by each character
    const array2D = arr.map(row => row.trim().split(" "));
    var answerArrayFlat = array2D.flat()
    //answerArrayFlat = answerArrayFlat.map(cell => cell.replace(/-/g, ''));
    answerArrayFlat.pop()
    answerArrayFlat = answerArrayFlat.join('');
    //console.log(answerArrayFlat);
    //console.log(answerArrayFlat.length);

    var myStringUnedited = output.substring(218, 440)
    //console.log(myStringUnedited)
    myStringUnedited = myStringUnedited.replace(/[\n\r]/g, "");
    myStringUnedited = myStringUnedited.replace(/\s{2}/g, "@");
    //console.log(myStringUnedited); // Output the string to console
    myStringUnedited = myStringUnedited.replace(/\s+/g, "");
    myStringUnedited = myStringUnedited.replace(/@/g, " ");
    //console.log(myStringUnedited)
    //console.log(myStringUnedited.length);

    // Generate 10 random indices
    const indices = [];
    while (indices.length < 10) {
      const index = Math.floor(Math.random() * myStringUnedited.length);
      const char = myStringUnedited[index];
      if (char !== '-' && !/\d/.test(char)) { // Check if the character is not a hyphen and not a number
        indices.push(index);
      }
    }

    // Replace characters at the random indices
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      if (index < myStringUnedited.length && index < answerArrayFlat.length) {
        myStringUnedited = myStringUnedited.substring(0, index) + answerArrayFlat[index] + myStringUnedited.substring(index + 1);
      }
    }
    res.json({ output, myStringUnedited, answerArrayFlat });
  });

  python.on('error', (err) => {
    console.error('Error executing Python script', err);
    res.status(500).json({ error: 'Python script execution failed' });
  });
});

// Serve the HTML file
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html'); // Load index.html
});

// Start the server
app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

