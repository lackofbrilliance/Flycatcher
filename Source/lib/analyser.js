var fs = require('fs');
var vm = require('vm');
var util = require('util');

var handler = {

    delete: function(name) {
        console.log(name)
        var self = this;
        return Proxy.createFunction(self,
        function() {
            return Proxy.create(self)
        });
    },

    // ignoring fundamental traps that aren't in ES5
    getOwnPropertyDescriptor: function(name) {
        var desc = Object.getOwnPropertyDescriptor(this, name);
        // a trapping proxy's properties must always be configurable
        if (desc !== undefined) {
            desc.configurable = true;
        }
        return desc;
    },

    // proxy[name] -> any
    get: function(rcvr, name) {
        var self = this;
        if (name === "valueOf") {
            return function() {
                return 35;
            }
        }
        else {
            return Proxy.createFunction(self,
            function() {
                return Proxy.create(self)
            });
        }
    },

    // proxy[name] = value
    set: function(receiver, name, value) {
        this[name] = Proxy.create(this);
        return true;
    },

    // name in proxy -> boolean
    has: function(name) {
        return false;
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
        return [];
    }
};

function getParamNames(func) {
    var reg = /\(([\s\S]*?)\)/;
    var params = reg.exec(func);
    if (params) 
        return params[1].split(',');
    else
        return [];
 }

exports.getClasses = function(cmd,classContext,cutName,mutName) {

    var classes = {};

    if (!classContext[cutName]){
        console.error("Error: specified class <" + cutName + "> was not found");
        console.error("(see README for information on recognised class definitions)");
        console.info(cmd.helpInformation());
        process.exit(1);
    }
    var mutDefined = false;
    for (var className in classContext) {
        if(typeof classContext[className] === "function") {
            // retrieving constructor for the class under test
            var constructor = classContext[className];
            
            var ctrParams = [];
            for (var i = 0; i<constructor.length; i++) {
                ctrParams.push({name: getParamNames(constructor)[i],
                                called: []});
            }
            var ctr = {def: constructor, params: ctrParams};

            var construct = (function() {
                function F(args) {
                    return constructor.apply(this, args);
                }
                F.prototype = constructor.prototype;
                return function(args) {
                    return new F(args);
                }
            })();
            
            var emptyParams = [];
            var len = constructor.length;
            for (var i = 0; i < len; i++) {
                // we use empty proxy parameters because we are not interested in
                // what the constructor methods achieve atm, just the class's methods
                emptyParams[i] = Proxy.create(handler);
            }

            // an instance of the class under test needs to be created in order
            // to retrieve the class's method signatures
            var c = {};
            try {
                c = construct(emptyParams);
            }
            catch (err) {
                console.error("Error in class constructor/function definition <" + className + "> :");
                console.error(err.toString());
                process.exit(1);
            }
            // retrieving methods
            var methods = [];
            for(var m in c) {
                var member = c[m];
                if(typeof member == "function") {
                    var methodParams = [];
                    for (var i = 0; i<member.length; i++) {
                        methodParams.push({name: getParamNames(member)[i],
                                           called: []});
                    }
                    var isMut = className === cutName && m === mutName;
                    if (isMut) {
                        mutDefined = true;
                    };
                    methods.push({name: m, def: c[m], params: methodParams, mut: isMut});
                }
            }
            classes[className] = {name : className, ctr : ctr, methods : methods};
        }
    }
    if(!mutDefined) {
        console.error("Error: specified method <" + mutName + "> was not found in class <"+ cutName +">");
        console.error("(see README for information on recognised class definitions)");
        console.info(cmd.helpInformation());
        process.exit(1);
    }
    return classes;
}