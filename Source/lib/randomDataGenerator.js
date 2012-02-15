var _ = require('underscore');
var dump = require('./utils').dump;

exports.generate = function(classes,params) {
    
    function getRandomNumber() {
        MAX_INT = 700;
        return Math.floor(Math.random()*MAX_INT);
    }
    function getRandomString() {
        MAX_LENGTH = 10;
        var string = "";
        var charSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

        for(var i=0; i < Math.ceil(Math.random()*MAX_LENGTH); i++) {
            string += charSet.charAt(Math.floor(Math.random() * charSet.length));
        }
        return string;
    }
    function getRandomBoolean() {
        return Math.floor(Math.random()*2) === 1;
    }
    function inferType(methods) {
        var currentMatches = 0;
        var name = "";
        var paramTypes = [];
        for(var c in classes) {
            var classMethods = classes[c].methods;
            var matches = _.intersection(_.pluck(classMethods,"name"),methods).length;
            if (matches > currentMatches) {
                currentMatches = matches;
                name = classes[c].ctr.def.name;
                ctrParams = classes[c].ctr.params;
                for (var p in ctrParams) {
                    paramTypes.push(inferType(ctrParams[p]))
                }
            }
        }
        if (currentMatches === 0) name = "Number";
        return {name : name, params : paramTypes};
    }
    
    var randomParams = [];
    for(var i = 0; i<params.length; i++) {
        randomParams[i] = inferType(params[i]);
    }
    return randomParams;
}