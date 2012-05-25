/*********** DISCLAIMER **************

    The code in this file is inspired
    by　and makes use of the unlicensed,
    open source code available at the
    time of edition, at:

 https://github.com/substack/node-bunker

***************************************/

var util = require('util');
var stackTrace = require('stack-trace');

var burrito = require('burrito');
var vm = require('vm');
var _ = require('underscore');
var EventEmitter = require('events').EventEmitter;

var Executor = module.exports.Executor = function(src, pgmInfo) 
{
    this.test = {};
    this.nodes = [];
    this.coverage = {};
    this.nodeNum = 0;
    this.currentCov = 0;

    this.names = {
        call: burrito.generateName(6),
        expr: burrito.generateName(6),
        stat: burrito.generateName(6)
    };

    this.source = src;
    this.context = this.createContext(pgmInfo);
    this.wrappedMUT = this.wrapMUT(pgmInfo);

    this.on('node', function(i) {
        this.coverage[i] = true;
    });

    this.on('cov',
    function(currentCoverage, good) {
        this.currentCov = Math.round((currentCoverage / _.size(this.coverage) * 100) *
        Math.pow(10, 2) / Math.pow(10, 2));
        if (good) {
            process.stdout.write("\b\b"+this.currentCov);
        }
    });
}

function ExecutorError(CUTname, methodName, paramIndex, pgmInfo) {
    Error.captureStackTrace(this, ExecutorError);
    this.CUTname = CUTname;
    this.methodName = methodName;
    this.paramIndex = paramIndex;
    this.pgmInfo = pgmInfo;
    this.isConstructorParam = function() {
        return CUTname === methodName;
    }
}

Executor.prototype = new EventEmitter;

Executor.prototype.getCoverage = function() {
    return this.currentCov;
}

Executor.prototype.setTest = function(test) {
    this.test = test;
};

Executor.prototype.wrapMUT = function(pgmInfo) {
    function wrapper(node) {

        if (node.name === 'call') {
            i++;
            node.wrap(names.call + '(' + i + ')(%s)');
            node.id = i;
        }
        else if (node.name === 'stat' || node.name === 'throw'
        || node.name === 'var') {
            i++;
            node.wrap('{' + names.stat + '(' + i + ');%s}');
            node.id = i;
        }
        else if (node.name === 'binary') {
            i++;
            node.wrap(names.expr + '(' + i + ')(%s)');
            node.id = i;
        }
        else if (node.name === 'unary-postfix' || node.name === 'unary-prefix') {
            i++;
            node.wrap(names.expr + '(' + i + ')(%s)');
            node.id = i;
        }
    }    
    
    var nodes = this.nodes;
    var names = this.names;
    var n = 0;
    
    var MUTdeclaration = pgmInfo.getCUTname() +
                         ".prototype.MUT = "  +
                         pgmInfo.getMUTdefinition();
    var i = 0;
    var wrapped = burrito(MUTdeclaration, wrapper, names);
    
    var coverage = this.coverage;
    _.forEach(wrapped.nodeIndexes,function(num){
        coverage[num] = false;
    });
    return wrapped.MUT;
}

function createExecHandler(pgmInfo) {

    var Handler = function(CUTname, methodName, paramIndex, exec) {
        this.CUTname = CUTname;
        this.methodName = methodName;
        this.paramIndex = paramIndex;
        this.pgmInfo = pgmInfo;
        this.exec = exec;
        this.isConstructorParam = function() {
            return CUTname === methodName;
        }
    }

    Handler.prototype = {
        
        // delete proxy[name] -> boolean
        delete: function(name) {
            return delete this.target[name];
        },

        // name in proxy -> boolean
        has: function(name) {
            return name in this.target;
        },

        // proxy[name] -> any
        get: function(receiver, name) {
            var methodName = this.methodName;

/*            console.log(_.find(this.classes[this.CUTname].methods,function(elem){
                return elem.name === methodName;
            }))
            console.log(this.isConstructorParam())
*/

/*            console.log("CUTname",this.CUTname,
                        "paramIndex",this.paramIndex,
                        "methodName",this.methodName,
                        "name",name)
*/
            // TODO index this.methodName directly vs filter
            if (name === "valueOf") {
                try {
                    throw new ExecutorError(this.CUTname,this.methodName,this.paramIndex,this.pgmInfo);
                }
                catch(err) {
                    var lineNum = stackTrace.parse(err)[1].lineNumber;
                    // shifting to correspond to correct array index
                    var line = this.exec.vmSource.split('\n')[lineNum - 1];

                    var called = err.isConstructorParam() ?
                        err.pgmInfo.getConstructorParams(err.CUTname)[err.paramIndex] :
                        _.find(err.pgmInfo.getMethods(err.CUTname),function(elem){
                            return elem.name === err.methodName;
                        }).params[err.paramIndex].called;
                    console.log(line);    
                    for (var op=0; op < operators.length; op++) {
                        if (line.indexOf(operators[op]) !== -1) {
                            called.push(operators[op]);
                            break;
                        }
                    };
                }
                return function() {
                    return 123;
                }
            }
/*            else if (name === "toString") {
                return function() {
                    return "HARO!";
                }

            }
*/
            else {
                
                var paramInfo = this.isConstructorParam() ?
                    this.pgmInfo.getConstructorParams(this.CUTname)[this.paramIndex] :
                    _.find(this.pgmInfo.getMethods[this.CUTname],function(elem){
                        return elem.name === methodName;
                    }).params[this.paramIndex];
                paramInfo.push(name);
                
                var self = this;
                return Proxy.createFunction(self,
                    function() {
                        return Proxy.create(self)
                });
            }
        },

        // proxy[name] = value
        set: function(receiver, name, value) {
//            console.log(name)
            if (canPut(this.target, name)) {
                // canPut as defined in ES5 8.12.4 [[CanPut]]
                this.target[name] = value;
                return true;
            }
            return false;
            // causes proxy to throw in strict mode, ignore otherwise
        },

        // for (var name in proxy) { ... }
        enumerate: function() {
            var result = [];
            for (var name in this.target) {
                result.push(name);
            };
            return result;
        },

        // Object.keys(proxy) -> [ string ]
        keys: function() {
            return Object.keys(this.target);
        }
    };
    return Handler;
}

Executor.prototype.createContext = function(pgmInfo) {
    var context = {};
    var Handler = createExecHandler(pgmInfo);
    function getProperties(o) {
        var own = {};
        var proto = {};
        for (var i in o) {
            if (o.hasOwnProperty(i)) {
                own[i] = {
                    value:o[i],
                    writable:true,
                    enumerable:true,
                    configurable:true
                };
            }
            else {
                proto[i] = {value:o[i]};
            }
        }
        return {own: own, proto: proto};
    }
    
    // we want to trap only the calls that the "proxy" object
    // below cannot answer (because the type for it is not
    // yet correct). hence the proxy is an object who does have
    // all the methods and fields of the type T we think it is (p.own)
    // but whose prototype does not only have the properties of the
    // usual T prototype, but *its* prototype (called when neither the
    // "proxy"'s direct properties nor its prototype resolve) is an object
    // of the type Proxy, whose handler is initialised to update the table
    // for the specific parameter that this "proxy" is supposed to represent
    var exec = this;
    context.proxy = function(o,CUTname,methodName,paramIndex) {
        var p = getProperties(o);
        var prox = Object.create(
            Object.create(Proxy.create(new Handler(CUTname,methodName,paramIndex,exec)),p.proto),
            p.own
        );
        return prox;
    }
    context.log = console.log;

        // adding the instrumentation methods to the runtime context
        var self = this;
        var stack = [];

        // we are only interested in the coverage of tests
        // which are usable i.e. those that have resolved
        // all of their types, so we test for test.hasUnknowns()

        context[self.names.call] = function(i) {
            if (!self.test.hasUnknowns()) {
                var node = self.nodes[i];
                stack.unshift(node);
                self.emit('node', i);
            }
            return function(expr) {
                stack.shift();
                return expr;
            };
        };

        context[self.names.expr] = function(i) {
            if (!self.test.hasUnknowns()) {
                var node = self.nodes[i];
                self.emit('node', i);
            }
            return function(expr) {
                return expr;
            };
        };

        context[self.names.stat] = function(i) {
            if (!self.test.hasUnknowns()) {
                var node = self.nodes[i];
                self.emit('node', i);            
            }
        };

        return context;
};


Executor.prototype.show = function() {
    this.showOriginal();
    this.showMUT();
    this.showTest();
}

Executor.prototype.showMUT = function() {
    console.log('-------------- MUT --------------------');
    console.log(this.wrappedMUT);
    console.log('---------------------------------------');
}

Executor.prototype.showOriginal = function() {
    console.log('-------------- SOURCE -----------------');
    console.log(this.source);
    console.log('---------------------------------------');
}

Executor.prototype.showTest = function() {
    console.log('-------------- TEST -------------------');
    console.log(this.test.toExecutorFormat());
    console.log('---------------------------------------');

}

Executor.prototype.covered = function() {
    return _.filter(_.values(this.coverage),_.identity).length;
}

// important for the operators which are superstrings of others
// to come earlier in the array
var operators = exports.operators = [ "++",
                                      "+",
                                      "--",
                                      "-",
                                      "*",
                                      "/",
                                      "%",
                                      ">>>",
                                      ">>",
                                      "<<",
                                      "~",
                                      "^",
                                      "||",
                                      "|",
                                      "&&",
                                      "&",
                                      "==",
                                      "!=",
                                      "!",
                                      ">=",
                                      ">",
                                      "<=",
                                      "<"                  
                                      ];

Executor.prototype.run = function() {
    this.vmSource = this.source + '\n' + this.wrappedMUT + '\n' + this.test.toExecutorFormat();
    if (!this.wrappedMUT) {
        console.warn("Warning: Executor.mut is an empty string")
    }
    if (!this.test) {
        console.warn("Warning: Executor.test is empty")
    }
    var before = this.covered();
    var res = {};
    try {
        res = vm.runInNewContext(this.vmSource, this.context);
    }
    catch(err) {
        console.log(err.stack);
    }

    var after = this.covered();
    var newCoverage = after > before;
    this.emit('cov', after, newCoverage);
    return {
        newCoverage: newCoverage,
        result: res,
        coverage: this.currentCov
    };
};
