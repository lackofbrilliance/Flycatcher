var randomData = require('./randomData.js');
var _ = require('underscore');
var util = require('util');

Test.prototype.toExecutorFormat = function() {
    var test = [];
    for (var i = 0; i<this.stack.length; ++i) {
        var e = this.stack[i];
        test[i] = e.elem.toExecutorFormat(e.paramIds);
    }
    return test.join('\n');
}

Test.prototype.toUnitTestFormat = function(result,testIndex) {
    var test = [];
    test[0] = "// Test #" + testIndex;
    for (var i = 0; i<this.stack.length; ++i) {
        var testElement = this.stack[i];
        test[i+1] = testElement.elem.toUnitTestFormat(testElement.paramIds,result);
    }
    return test.join('\n');
}

function CUTdeclaration(type, params, id) {
    this.type = type;
    this.params = params;
    this.id = id;
    this.identifier = type.toLowerCase() + id;
    this.toExecutorFormat = function(paramIds) {
        
        // the CUT might need a different proxying, however it doesn't need proxying
        // for catching erroneous method calls (all its methods are known from the analyser
        // and called specifically)
        
        var ret = "var " + this.identifier + " = new " + this.type
                         + "(" + toParams(paramIds) + ");";
        return ret;
    }
    this.toUnitTestFormat = function(paramIds) {
        
        // the CUT might need a different proxying, however it doesn't need proxying
        // for catching erroneous method calls (all its methods are known from the analyser
        // and called specifically)
        
        var ret = "var " + this.identifier + " = new " + this.type
                         + "(" + toParams(paramIds) + ");";
        return ret;
    }
    this.getIdentifier = function() {
        return this.identifier;
    }
}

function Declaration(type,params,identifier,parentType,parentMethod,index,id,reuse) {
    this.reuse = reuse;
    this.type = type;
    this.params = params;
    this.identifier = identifier;
    this.id = id;
    this.parentType = parentType;
    this.parentMethod = parentMethod;
    this.index = index;
    this.toExecutorFormat = function(paramIdentifiers) {
        
        // the CUT might need a different proxying, however it doesn't 
        // need proxying for catching erroneous method calls (all its 
        // methods are known from the analyser and called specifically)
        var type = this.type === "Unknown" ? "Object" : this.type;
        var ret = "var " + this.identifier + " = proxy"
                         + "(new " +type+ executorParams(paramIdentifiers,
                                                         parentType,
                                                         parentMethod,
                                                         index) + ");";
        return ret;
    }
    this.toUnitTestFormat = function(paramIdentifiers) {
        
        // the CUT might need a different proxying, however it doesn't need proxying
        // for catching erroneous method calls (all its methods are known from the analyser
        // and called specifically)
        var type = this.type === "Unknown" ? "Object" : this.type;
        var r = "var " + this.identifier + " = new " +type;
            r += "(" + toParams(paramIdentifiers) + ");";
        return r;
    }
    this.getIdentifier = function() {
        return this.identifier;
    }
}

function Call(instanceIdentifier,method,params,type) {
    this.instanceIdentifier = instanceIdentifier;
    this.method = method;
    this.params = params;
    this.type = type;
    this.toExecutorFormat = this.toUnitTestFormat = function(paramIdentifiers) {
        var r = instanceIdentifier + "." + this.method;
            r += "(" + toParams(paramIdentifiers) + ");"
        return r;
    }
}

function MUTcall(instanceIdentifier,method,params,type) {
    this.instanceIdentifier = instanceIdentifier;
    this.method = method;
    this.type = type;
    this.params = params;
    this.toExecutorFormat = function(paramIdentifiers) {
        var ret = instanceIdentifier + ".MUT"
                  + "(" + toParams(paramIdentifiers) + ");"
        return ret;
    }
    this.toUnitTestFormat = function(paramIdentifiers,result) {        
        if (typeof result === "string") result = "\"" + result + "\"";
        var assertion = instanceIdentifier + "." + this.method + "(";
        assertion += toParams(paramIdentifiers) + ") === " + result;
        var ret = "assert.ok(" + assertion + ",\n         \'" + assertion + "\');";
        return ret;
    }
}


function isPrimitive(type) {
    return type === "Number" ||
           type === "String" ||
           type === "Boolean";
}

function isUnknown(type) { return type === "Unknown"; }

function isUserDefined(type) { return !isUnknown(type) && !isPrimitive(type); }

function toParams(paramIds) {
    var r = "";
    for (var i = 0; i<paramIds.length; ++i) {
        r += paramIds[i];
        if(i < paramIds.length-1) r += ",";
    }
    return r;
}

function executorParams(ids,parentType,parentMethod,index) {
    var ret = "(" + toParams(ids) + "),";
    ret += "\"" + parentType + "\",\"" + parentMethod + "\"," + index;
    return ret;
}

function Test() {
    this.unknowns = false;
    this.stack = [];
    this.pool = {};
}

Test.prototype.hasUnknowns = function() {
    return this.unknowns;
}

Test.prototype.push = function(elem) {
    var isDecl = elem instanceof Declaration ||
                 elem instanceof CUTdeclaration;
    var elemType = elem.type;
    var elemId = elem.id;
    var reusingParent = elem.reuse;
    if(elemType === "Unknown") {
        this.unknowns = true;
    }
    var params = elem.params;
    var paramIds = [];
    
    if (isDecl) {
        this.pool[elemType] = this.pool[elemType] || {};
        this.pool[elemType][elemId] = this.pool[elemType][elemId] || [];
    }  

    //console.log(this.pool);
    for(var p = 0; p<params.length; ++p) {
        
        var paramType = params[p].name;
        this.pool[paramType] = this.pool[paramType] || {};

        // we can only decide to reuse a param if it is not already
        // predetermined by the reuse of the parent
        var reusingParam = false;

        var id;
        // parent is from the pool, we need to use a predefined param
        if(reusingParent){
            id = this.pool[elemType][elemId][p];
        }
        else {
            // if not already reusing this parameter by default because
            // we are reusing the parent, we can decide to reuse the
            // parameter only
            var keys = Object.keys(this.pool[paramType]);
            var length = keys.length;
            reusingParam = length && Math.random() > 0.75;
            if (reusingParam) {
                id = keys[Math.floor(Math.random()*length)]-0;
            }
            else {
                // when the parameter is of type Number, the number
                // itself becomes the identifier
                if (!isPrimitive(paramType)) id = _.uniqueId();
                else id = randomData.getPrimitive(paramType);
                // id for the current param is new so *its* parameter array
                // in the pool needs to be initialised
                this.pool[paramType][id] = [];
            }
            // we need to update the parameter array of the parent type
            // with the id of the current param (whether it reuses another
            // of *its* type or not) so that we can recreate the parent type if needed
            if(isDecl) this.pool[elemType][elemId].push(id);
        }
        
        // TODO: regroup identifier generation
        var paramId = !isPrimitive(paramType) ?
                         paramType.toLowerCase() + id + "_" + p: id;
        paramIds.push(paramId);
        
        if (!isPrimitive(paramType)) {
            var method;
            if (isDecl) {
                // this refers to the constructor whose name is the type
                method = elemType;
            }
            else {
                method = elem.method;
            }
            this.push(new Declaration(paramType, params[p].params,
                                      paramId, elemType, method,
                                      p, id, reusingParam || reusingParent));
        }
    }
    this.stack.push({elem:elem,paramIds:paramIds});
}

Test.prototype.show = function() {
//    console.log(this.stack)
}

exports.generate = function(classes,CUTname,index) {
    var CUTinfo = classes[CUTname];
    MAX_SEQUENCE_LENGTH = 5;
    var inferredParams = randomData.inferTypes(classes,CUTinfo.ctr.params);
    var t = new Test();    
    var instance = new CUTdeclaration(CUTname,inferredParams,_.uniqueId());
    t.push(instance);
    var callSequence = [];
    randomSequenceLength = Math.ceil(Math.random()*MAX_SEQUENCE_LENGTH);
    if (CUTinfo.methods.length > 1) {
        for (var j = 0; j<randomSequenceLength;j++) {
            var randomMethod = Math.floor(Math.random()*CUTinfo.methods.length);

            // TODO: if index is 0 initially FAILS IF CLASS UNDER TEST HAS NO METHODS
            while ((index && randomMethod === index) || CUTinfo.methods[randomMethod].mut) {
                randomMethod = Math.floor(Math.random()*CUTinfo.methods.length);
            }
            var method = CUTinfo.methods[randomMethod];
            var call = new Call(instance.getIdentifier(),
                                method.name,
                                randomData.inferTypes(classes,method.params),
                                CUTname);
            t.push(call);
        }
    }

    var mutParams = {};
    var MUTname = "";
    if (index) {
        MUTname = CUTinfo.methods[index].name;
        mutParams = CUTinfo.methods[index].params;
    }
    else {
        var mut_ = CUTinfo.methods.filter(function(x){return x.mut})[0];
        MUTname = mut_.name;
        mutParams = mut_.params;
    }
    var mut = new MUTcall(instance.getIdentifier(),
                          MUTname,
                          randomData.inferTypes(classes,mutParams),
                          CUTname);
    t.push(mut);
    return t;
}