#! /usr/bin/env node --harmony_proxies

var Analyser = require('./lib/analyser.js');
var RandomTest = require('./lib/randomTest.js');
var Executor = require('./lib/executor.js').Executor;

var util = require('util');
var fs = require('fs');
var vm = require('vm');

var _ = require('underscore');
var colors = require('colors');
var cmd = require('commander');

colors.setTheme({
  info1: 'blue',
  info2: 'yellow',  
  warn: 'magenta',
  good: 'green',
  error: 'red',
  bad: 'red'
});

cmd
.version('1.0')
.usage('<file path> <class name> [options]')
.option('-m, --method <name>', 'generate tests for a specific method')
.option('-t, --timeout <num>', 'timeout after a number of valid tests with no coverage', Number, Number.MAX_INT)
.option('-u, --minimum-uses <num>', 'number of parameter uses required before attempting type inference', Number, 20)
.option('-n, --custom-numbers <name>', 'JavaScript RegExp describing a custom set of numbers to use e.g \'[1-4]\'')
.option('-s, --custom-strings <name>', 'JavaScript RegExp describing a custom set of strings to use e.g. \'[a-d]+\'')
.option('-l, --sequence-length <num>', 'maximum length of method call sequence in tests', Number, 20)
.option('-N, --namespace <name>', 'specify a namespace for your class')
.parse(process.argv);

(function main(cmd) {
    if (cmd.args.length !== 2) {
        console.info(cmd.helpInformation());
        process.exit(1);
    }

    var filePath = cmd.args[0];
    var CUTname = cmd.args[1];

    try {
        var src = fs.readFileSync(filePath, 'utf8');
    }
     catch(error) {
        console.error(error.toString());
        console.info(cmd.helpInformation());
        process.exit(1);
    }

    // TODO remove log from the classContext and add options to specify the type
    // of environment that the test programs should be run, adding the appropriate
    // context objects
    var classContext = {};
    Object.defineProperty(classContext,"log", {get : function() {return console.log},
                                               enumerable : false});
    // Object.defineProperty(classContext,"util", {get : function() {return util},
    //                                             enumerable : false});
    // Object.defineProperty(classContext,"EventEmitter", {get : function() {return EventEmitter},
    //                                                     enumerable : false});
    // Object.defineProperty(classContext,"crypto", {get : function() {return require('crypto')},
    //                                               enumerable : false});
    try {
        vm.runInNewContext(src, classContext);
    }
     catch(err) {
        console.error("Syntax error while parsing source <" + filePath + ">");
        console.log(err.stack);
        process.exit(1);
    }
    
    var pgmInfo = Analyser.getProgramInfo(cmd, classContext, CUTname);
    
    // initialising custom primitive data generators if need be
    var numRE = cmd.customNumbers;
    if (numRE) RandomTest.DataGenerator.setNumbers(numRE);
    var strRE = cmd.customStrings;
    if (strRE) RandomTest.DataGenerator.setStrings(strRE);
        
    var unitTests = [];
    var failingTests = [];

    // cmd.method is undefined if MUT not specified by user
    var cmdMethod = cmd.method;
    var CUTmethods = pgmInfo.getMethods(CUTname);
    var MUTdefined;
    for (var m in CUTmethods) {
        var method = CUTmethods[m];
        if (cmdMethod && method.name !== cmdMethod) continue;
        MUTdefined = true;
        pgmInfo.setMUT(method);
        generateTests(src, pgmInfo, unitTests, failingTests);
    }
    
    if(!MUTdefined) {
        console.error("Error: specified method <" + cmdMethod + "> was not found in class <" + CUTname +">");
        console.error("(see README for information on recognised class definitions)");
        console.log(cmd.helpInformation());
    }
    
    outputTests(src, pgmInfo, unitTests, failingTests);
})(cmd);

function Timeout(){
    Error.captureStackTrace(this, Timeout);
    this.toString = function() {
        return "TIMEOUT: ".info2 + "no coverage achieved with the last " +
                cmd.timeout + " valid tests";
    }
};

function generateTests(src, pgmInfo, unitTests, failingTests) {
    try {
        var noCoverage = 0;
        var exec = new Executor(src, pgmInfo);

        var MUTname = pgmInfo.MUT.name;
        var CUTname = pgmInfo.CUTname;
        console.log("\nGenerating tests for method <" + MUTname + "> from class <" + CUTname + "> :   ");
        console.log("------------------------------------------------------------------------------------------");
        var count = 0;
        while (exec.getCoverage() < 100) {
            var test = RandomTest.generate(pgmInfo);            
            exec.setTest(test);
            // exec.showMUT();
            // exec.showTest(test);
            var testRun = exec.run();
            
            if(!test.hasUnknowns()) {
                if (testRun.newCoverage) {
                    unitTests.push(test.toUnitTestFormat(testRun.results, ++count));
                }
                // the timeout is to avoid looping forever in the case
                // that the generated tests cannot achieve any further
                // coverage due to errors or dead code
                else if(++noCoverage >= cmd.timeout) throw new Timeout();
                // keep track of the non-unknown tests that don't add coverage so that
                // if the timeout expires we can see what the failing tests were
                if (testRun.error) failingTests.push(test.toFailingTestFormat(testRun.msg));
            }
            // exec.showCoverage();
        }
    }
    catch(err) {
        if(err instanceof Timeout) {
            console.log(err.toString());
        }
        else {
            console.error(("ERROR while generating tests for method <" + MUTname + ">").error);
            if (err.type === "stack_overflow") 
                console.log("STACK OVERFLOW: there must be a cycle in the inferred parameter definitions".error);
            else console.log(err.stack);            
        }
    }
}

function outputTests(src, pgmInfo, unitTests, failingTests) {
    var CUTname = pgmInfo.CUTname;
    if (unitTests.length) {
        var unitTestsFile = "./results/Flycatcher_" + CUTname + ".js";
        console.log(("\n--> Unit tests can be found in " + unitTestsFile).good);
        fs.writeFileSync(unitTestsFile,
            generateUnitTests(src, CUTname, unitTests)
        );
    }
    else console.log("\n--> No unit tests were generated.".bad);

    if (failingTests.length) {
        var failingTestsFile = "./results/Flycatcher_" + CUTname + ".log";
        console.log(("--> Failings tests can be found in " + failingTestsFile).bad);
        fs.writeFileSync(failingTestsFile,
            generateFailingTests(src, CUTname, failingTests)
        );
    }
    else console.log("--> No candidate tests failed".good);
    
    function generateFailingTests(src, CUTname, tests) {
        var header = "/*****************************************\n\n";
        header += "                  FLYCATCHER\n";
        header += "                 FAILING TEST LOG\n";
        header += "        ------------------------------\n\n";
        header += "        CLASS: " + CUTname + "\n";
        header += "*******************************************/\n\n"
        var res = "";
        for (var t=0; t < tests.length; t++) {
            res += tests[t];
            res += "\n\n";
        };
        return header + res;
    }

    function generateUnitTests(src, CUTname, tests) {
        var header = "/*****************************************\n\n";
        header += "                  FLYCATCHER\n";
        header += "        AUTOMATIC UNIT TEST GENERATION\n";
        header += "        ------------------------------\n\n";
        header += "        CLASS: " + CUTname + "\n";
        header += "*******************************************/\n\n"
        header += "var assert = require('assert');\n\n";
        var success = "console.log(\"Unit test suite completed with success!\")";
        var content = header + src +"\n\ntry {\n\n" + tests.join('\n\n') + "\n\n"+ success; 
        content += "\n}\ncatch(err) {\n    console.log(err.name,err.message)\n}";
        return content;
    }
}