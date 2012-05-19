#! /usr/bin/env node --harmony_proxies

var dump = require('./lib/utils.js').dump;
var analyser = require('./lib/analyser.js');
var randomTest = require('./lib/randomTest.js');
var Executor = require('./lib/executor.js').Executor;

var fs = require('fs');
var vm = require('vm');
var cmd = require('commander');

cmd
.version('1.0')
.usage('[options] <file path> <class name>')
.option('-m, --method <name>', 'generate tests for a specific method')
.option('-c, --coverage_max <num>', 'maximum coverage %', Number, 100)
.parse(process.argv);

if (cmd.args.length !== 2) {
    console.info(cmd.helpInformation());
    process.exit(1);
}

var filePath = cmd.args[0];
// cut : class under test
var CUTname = cmd.args[1];

try {
    var src = fs.readFileSync(filePath, 'utf8');
}
 catch(error) {
    console.error(error.toString());
    console.info(cmd.helpInformation());
    process.exit(1);
}

var classContext = {};
try {
    vm.runInNewContext(src, classContext);
}
 catch(err) {
    console.error("Syntax error while parsing source <" + filePath + ">");
    console.error(err.toString());
    process.exit(1);
}

// mut: method under test
var MUTname = cmd.method;
var maxCoverage = cmd.coverage_max;

if (MUTname) {
// if method under test has been specified
    var classes = analyser.getClasses(cmd, classContext, CUTname, MUTname);
    var exec = new Executor(src, classes, CUTname);
    process.stdout.write("Generating tests for at least ");
    process.stdout.write(maxCoverage + "\% coverage of ");
    process.stdout.write("method <" + MUTname + "> from class <");
    process.stdout.write(CUTname + "> :   ");
    var goodTests = [];
    var count = 0;
    console.log();
    while (exec.getCoverage() < maxCoverage) {
        var test = randomTest.generate(classes, CUTname);
        exec.setTest(test);
        //exec.showTest(test);
        var testRun = exec.run();
        if (testRun.newCoverage && !test.hasUnknowns()) {
            goodTests.push(test.toUnitTestFormat(testRun.result,++count));
        }
    }
    var fileName = "Flycatcher_" + CUTname + "_" + MUTname + ".js";
    process.stdout.write(" (" + (testRun ? testRun.coverage : 0) + "\%)\nGeneration succesful.\n");
    process.stdout.write("Tests can be found in " + fileName + "\n\n");

    fs.writeFileSync(fileName,generateContent(src,CUTname,MUTname,goodTests));
}
else {
// by default generates tests for all of a class's methods    

}

function generateContent(src,CUTname,MUTname,tests) {
    var header = "/*****************************************\n\n";
    header += "                  FLYCATCHER\n";
    header += "        AUTOMATIC UNIT TEST GENERATION\n";
    header += "        ------------------------------\n\n";
    header += "        CLASS: " + CUTname + "\n";
    header += "        METHOD: " + MUTname + "\n\n";
    header += "*******************************************/\n\n"
    header += "var assert = require('assert');\n\n";
    var success = "console.log(\"Unit test suite completed with success!\")";
    var content = header + src +"\n\ntry {\n\n" + tests.join('\n\n') + "\n\n"+ success; 
    content += "\n}\ncatch(err) {\n    console.log(err.name,err.message)\n}";
    return content;
}
