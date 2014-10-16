var FieldVal = (function(){
    "use strict";

    /* istanbul ignore next */
    if (!Array.isArray) {
        Array.isArray = function (value) {
            return (Object.prototype.toString.call(value) === '[object Array]');
        };
    }

    var is_empty = function(obj){
        var key;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) return false;
        }
        return true;
    }

    function FieldVal(validating, existing_error) {
        var fv = this;

        fv.async_waiting = 0;

        fv.validating = validating;
        fv.missing_keys = {};
        fv.invalid_keys = {};
        fv.unrecognized_keys = {};
        fv.recognized_keys = {};

        //Top level errors - added using .error() 
        fv.errors = [];

        if(existing_error!==undefined){
            //Provided a (potentially undefined) existing error

            if(existing_error){
                var key_error;
                if(existing_error.error===FieldVal.ONE_OR_MORE_ERRORS){
                    //The existing_error is a key error
                    key_error = existing_error;
                } else if(existing_error.error===FieldVal.MULTIPLE_ERRORS){
                    for(var i = 0; i < existing_error.errors.length; i++){
                        var inner_error = existing_error.errors[i];

                        if(inner_error.error===0){
                            key_error = inner_error;
                            //Don't add the key_error to fv.errors (continue)
                            continue;
                        }
                        //Add other errors to fv.errors
                        fv.errors.push(inner_error);
                    }
                } else {
                    //Only have non-key error
                    fv.errors.push(existing_error);
                }

                if(key_error){
                    for(var j in validating){
                        if(validating.hasOwnProperty(j)) {
                            fv.recognized_keys[j] = true;
                        }
                    }
                    if(key_error.missing){
                        fv.missing_keys = key_error.missing;
                    }
                    if(key_error.unrecognized){
                        fv.unrecognized_keys = key_error.unrecognized;
                        for(var k in fv.unrecognized_keys){
                            if(fv.unrecognized_keys.hasOwnProperty(k)) {
                                delete fv.recognized_keys[k];
                            }
                        }
                    }
                    if(key_error.invalid){
                        fv.invalid_keys = key_error.invalid;
                    }

                }
            } else {
                for(var j in validating){
                    if(validating.hasOwnProperty(j)) {
                        fv.recognized_keys[j] = true;
                    }
                }
            }
        }
    }

    FieldVal.prototype.dig = function(){
        var fv = this;

        var keys;
        var first_argument = arguments[0];
        if(Array.isArray(first_argument)){
            keys = first_argument;
        } else {
            keys = arguments;
        }

        var current_value = fv.validating;
        var current_error = fv;
        for(var i = 0; i < keys.length; i++){
            var this_key = keys[i];
            current_value = current_value[this_key];
            if(current_value===undefined){
                return undefined;
            }
            if(current_error){
                var invalid;
                if(current_error instanceof FieldVal){
                    invalid = current_error.invalid_keys;
                } else {
                    invalid = current_error.invalid;
                }
                if(invalid){
                    current_error = invalid[this_key];
                }
            }
        }
        return new FieldVal(current_value,current_error);
    };


    //TODO guard against invalid arguments
    FieldVal.prototype.invalid = function(){
        var fv = this;

        //error is the last argument, previous arguments are keys
        var error = arguments[arguments.length-1];

        var keys, keys_length;
        if(arguments.length===2){

            var first_argument = arguments[0];
            if(Array.isArray(first_argument)){
                keys = first_argument;
                keys_length = first_argument.length;
            } else {

                fv.invalid_keys[arguments[0]] = FieldVal.add_to_invalid(
                    error, 
                    fv.invalid_keys[arguments[0]]
                );

                return fv;
            }
        } else {
            keys = arguments;
            keys_length = arguments.length - 1;
        }

        var current_error = fv;
        for(var i = 0; i < keys_length; i++){
            var this_key = keys[i];

            var current_invalid;
            if(current_error instanceof FieldVal){
                current_invalid = current_error.invalid_keys;
            } else {
                current_invalid = current_error.invalid;
            }

            var new_error;
            if(i===keys_length-1){
                new_error = error;
            } else{
                new_error = current_invalid[this_key];
            }
            if(!new_error){
                new_error = {
                    error: FieldVal.ONE_OR_MORE_ERRORS,
                    error_message: FieldVal.ONE_OR_MORE_ERRORS_STRING,
                    invalid: {}
                };
            }

            if(current_error instanceof FieldVal){
                current_error.invalid(this_key, new_error);
            } else {
                current_invalid[this_key] = FieldVal.add_to_invalid(
                    new_error, 
                    current_invalid[this_key]
                );
            }

            current_error = new_error;
        }

        return fv;
    };

    FieldVal.prototype.default_value = function (default_value) {
        var fv = this;

        return {
            get: function () {
                var get_result = fv.get.apply(fv, arguments);
                if (get_result !== undefined) {
                    return get_result;
                }
                //No value. Return the default
                return default_value;
            }
        };
    };

    FieldVal.prototype.get = function (field_name) {//Additional arguments are checks
        var fv = this;

        var checks = Array.prototype.slice.call(arguments, 1);

        var did_return = false;
        var to_return;
        var async_return = fv.get_async(field_name, checks, function(value){
            did_return = true;
            to_return = value;
        });

        if(async_return===FieldVal.ASYNC){
            //At least one of the checks is async
            throw new Error(".get used with async checks, use .get_async.");
        } else {
            return to_return;
        }
    };

    FieldVal.prototype.get_async = function (field_name, checks, done){
        var fv = this;

        if(!Array.isArray(checks)){
            throw new Error(".get_async second argument must be an array of checks");
        }

        var value = fv.validating[field_name];
        fv.recognized_keys[field_name] = true;

        var use_checks_res = FieldVal.use_checks(value, checks, {
            validator: fv, 
            field_name: field_name,
            emit: function (new_value) {
                value = new_value;
            }
        },function(check_result){
            if(done!==undefined){
                done(value);
            }
        });

        return (use_checks_res === FieldVal.ASYNC) ? FieldVal.ASYNC : undefined;
    };

    //Top level error - something that cannot be assigned to a particular key
    FieldVal.prototype.error = function (error) {
        var fv = this;

        fv.errors.push(error);

        return fv;
    };

    FieldVal.add_to_invalid = function(this_error, existing){
        var fv = this;

        if (existing !== undefined) {

            //Add to an existing error
            if (existing.errors !== undefined) {
                for(var i = 0; i < existing.errors.length; i++){
                    var inner_error = existing.errors;
                    //If error codes match
                    if(inner_error.error!==undefined && (inner_error.error === this_error.error)){
                        //Replace the error
                        existing.errors[i] = this_error;
                    }
                }
                existing.errors.push(this_error);
            } else {
                //If the error codes match
                if(existing.error!==undefined && (existing.error === this_error.error)){
                    //Replace the error
                    existing = this_error;
                } else {
                    existing = {
                        error: FieldVal.MULTIPLE_ERRORS,
                        error_message: "Multiple errors.",
                        errors: [existing, this_error]
                    };
                }
            }
            return existing;
        } 
        return this_error;
    };

    FieldVal.prototype.missing = function (field_name, flags) {
        var fv = this;

        fv.missing_keys[field_name] = FieldVal.create_error(FieldVal.MISSING_ERROR, flags);
        return fv;
    };

    FieldVal.prototype.unrecognized = function (field_name) {
        var fv = this;

        fv.unrecognized_keys[field_name] = {
            error_message: "Unrecognized field.",
            error: FieldVal.FIELD_UNRECOGNIZED
        };
        return fv;
    };

    FieldVal.prototype.recognized = function (field_name) {
        var fv = this;

        fv.recognized_keys[field_name] = true;

        return fv;
    };

    //Exists to allow processing of remaining keys after known keys are checked
    FieldVal.prototype.get_unrecognized = function () {
        var fv = this;

        var unrecognized = [];
        var key;
        for (key in fv.validating) {
            /* istanbul ignore else */
            if (fv.validating.hasOwnProperty(key)) {
                if (fv.recognized_keys[key] !== true) {
                    unrecognized.push(key);
                }
            }
        }
        return unrecognized;
    };

    FieldVal.prototype.async_call_ended = function(){
        var fv = this;

        fv.async_waiting--;

        if(fv.async_waiting<=0){
            if(fv.end_callback){
                fv.end_callback(fv.generate_response(), fv.recognized_keys);
            }
        }
    };

    FieldVal.prototype.generate_response = function(){
        var fv = this;

        var returning = {};

        var has_error = false;

        var returning_unrecognized = {};

        //Iterate through manually unrecognized keys
        var key;
        for (key in fv.unrecognized_keys) {
            /* istanbul ignore else */
            if (fv.unrecognized_keys.hasOwnProperty(key)) {
                returning_unrecognized[key] = fv.unrecognized_keys[key];
            }
        }

        var auto_unrecognized = fv.get_unrecognized();
        var i, auto_key;
        for (i = 0; i < auto_unrecognized.length; i++) {
            auto_key = auto_unrecognized[i];
            if (!returning_unrecognized[auto_key]) {
                returning_unrecognized[auto_key] = {
                    error_message: "Unrecognized field.",
                    error: FieldVal.FIELD_UNRECOGNIZED
                };
            }
        }

        if (!is_empty(fv.missing_keys)) {
            returning.missing = fv.missing_keys;
            has_error = true;
        }
        if (!is_empty(fv.invalid_keys)) {
            returning.invalid = fv.invalid_keys;
            has_error = true;
        }
        if (!is_empty(returning_unrecognized)) {
            returning.unrecognized = returning_unrecognized;
            has_error = true;
        }

        if (has_error) {
            returning.error_message = FieldVal.ONE_OR_MORE_ERRORS_STRING;
            returning.error = FieldVal.ONE_OR_MORE_ERRORS;

            if (fv.errors.length === 0) {
                return returning;
            }

            fv.errors.push(returning);
        }

        if (fv.errors.length !== 0) {
            //Have top level errors

            if (fv.errors.length === 1) {
                //Only 1 error, just return it
                return fv.errors[0];
            }

            //Return a "multiple errors" error
            return {
                error: FieldVal.MULTIPLE_ERRORS,
                error_message: "Multiple errors.",
                errors: fv.errors
            };
        }

        return null;
    };

    FieldVal.prototype.end = function (callback) {
        var fv = this;

        if(callback){
            fv.end_callback = callback;

            if(fv.async_waiting<=0){
                callback(fv.generate_response(), fv.recognized_keys);
            }
        } else {
            return fv.generate_response();
        }
    };

    FieldVal.prototype.end_with_recognized = function (callback) {
        var fv = this;

        if(callback){
            fv.end(callback);
        } else {
            if(fv.async_waiting>0){
                return [fv.generate_response(), fv.recognized_keys];
            }
        }
    };

    /* Global namespaces (e.g. Math.sqrt) are used as constants 
     * to prevent multiple instances of FieldVal (due to being 
     * a dependency) having not-strictly-equal constants. */
    FieldVal.ASYNC = -1;//Used to indicate async functions
    FieldVal.REQUIRED_ERROR = Math.sqrt;
    FieldVal.NOT_REQUIRED_BUT_MISSING = Math.floor;

    FieldVal.ONE_OR_MORE_ERRORS = 0;
    FieldVal.ONE_OR_MORE_ERRORS_STRING = "One or more errors.";
    FieldVal.FIELD_MISSING = 1;
    FieldVal.INCORRECT_FIELD_TYPE = 2;
    FieldVal.FIELD_UNRECOGNIZED = 3;
    FieldVal.MULTIPLE_ERRORS = 4;

    FieldVal.INCORRECT_TYPE_ERROR = function (expected_type, type) {
        return {
            error_message: "Incorrect field type. Expected " + expected_type + ".",
            error: FieldVal.INCORRECT_FIELD_TYPE,
            expected: expected_type,
            received: type
        };
    };

    FieldVal.MISSING_ERROR = function () {
        return {
            error_message: "Field missing.",
            error: FieldVal.FIELD_MISSING
        };
    };

    FieldVal.get_value_and_type = function (value, desired_type, flags) {
        if (!flags) {
            flags = {};
        }
        var parse = flags.parse !== undefined ? flags.parse : false;

        if (typeof value !== 'string' || parse) {
            if (desired_type === "integer") {
                var parsed_int = parseInt(value, 10);
                if (!isNaN(parsed_int) && (parsed_int.toString()).length === (value.toString()).length) {
                    value = parsed_int;
                    desired_type = parsed_int;
                    desired_type = "number";
                }
            } else if (desired_type === "float" || desired_type === "number") {
                var parsed_float = parseFloat(value, 10);
                if (!isNaN(parsed_float) && (parsed_float.toString()).length === (value.toString()).length) {
                    value = parsed_float;
                    desired_type = "number";
                }
            }
        }

        var type = typeof value;

        if (type === "object") {
            //typeof on Array returns "object", do check for an array
            if (Array.isArray(value)) {
                type = "array";
            }
        }

        return {
            type: type,
            desired_type: desired_type,
            value: value
        };
    };

    FieldVal.use_check = function (this_check, shared_options, use_check_done) {

        var this_check_function;
        var stop_on_error = true;//Default to true
        var flags = {};
        var i = 0;

        if ((typeof this_check) === 'object') {
            if (Array.isArray(this_check)) {
                var any_async = false;
                var this_check_array = this_check;
                var did_return = false;
                var check_done = function(){
                    i++;
                    if(shared_options.stop || i>this_check_array.length){
                        did_return = true;
                        use_check_done();
                        return;
                    }
                    var check_res = FieldVal.use_check(
                        this_check_array[i-1],
                        shared_options,
                        function(){
                            check_done();
                        }
                    );
                    if(check_res===FieldVal.ASYNC){
                        any_async = true;
                    }
                };
                check_done();
                if(did_return){
                    if(any_async){
                        return FieldVal.ASYNC;
                    } else {
                        return;
                    }
                }
                return FieldVal.ASYNC;
            } else {
                flags = this_check;
                this_check_function = flags.check;
                if (flags && (flags.stop_on_error !== undefined)) {
                    stop_on_error = flags.stop_on_error;
                }
            }
        } else if(typeof this_check === 'function') {
            this_check_function = this_check;
            stop_on_error = true;//defaults to true
        } else {
            throw new Error("A check can only be provided as a function or as an object with a function as the .check property.");
        }

        var with_response = function(response){
            if (response !== null && response !== undefined) {
                if (stop_on_error) {
                    shared_options.stop = true;
                }
                shared_options.had_error = true;

                if (response === FieldVal.REQUIRED_ERROR) {

                    if (shared_options.field_name!==undefined) {
                        shared_options.validator.missing(shared_options.field_name, flags);
                        use_check_done();
                        return;
                    } else {
                        if (shared_options.existing_validator) {
                        
                            shared_options.validator.error(
                                FieldVal.create_error(FieldVal.MISSING_ERROR, flags)
                            );
                            use_check_done();
                            return;
                        } else {
                            shared_options.return_missing = true;
                            use_check_done();
                            return;
                        }
                    }
                } else if (response === FieldVal.NOT_REQUIRED_BUT_MISSING) {
                    //NOT_REQUIRED_BUT_MISSING means "don't process proceeding checks, but don't throw an error"
                    use_check_done();
                } else {

                    if (shared_options.existing_validator) {
                        if (shared_options.field_name) {
                            shared_options.validator.invalid(shared_options.field_name, response);
                        } else {
                            shared_options.validator.error(response);
                        }
                        use_check_done();
                    } else {
                        shared_options.validator.error(response);
                        use_check_done();
                    }
                }
            } else {
                use_check_done();
            }
        };

        var check_response = this_check_function(shared_options.value, shared_options.emit, function(response){
            //Response callback
            with_response(response);
        });
        if (this_check_function.length===3){//Is async - it has a third (callback) parameter
            //Waiting for async
            return FieldVal.ASYNC;
        } else {
            with_response(check_response);
            return null;
        }
    };

    FieldVal.use_checks = function (value, checks, options, done) {

        if(typeof options === 'function'){
            done = options;
            options = undefined;
        }

        if(!options){
            options = {};
        }

        var shared_options = {
            value: value,
            field_name: options.field_name,
            emit: function(emitted){
                shared_options.value = emitted;
            },
            options: options,
            stop: false,
            return_missing: false,
            had_error: false
        };

        if (options.validator) {
            shared_options.validator = options.validator;
            shared_options.existing_validator = true;
        } else {
            shared_options.validator = new FieldVal();
        }

        var did_return = false;
        var to_return;
        var finish = function(response){
            to_return = response;
            did_return = true;
            if(done){//The done callback isn't required
                done(response);
            }
        };
        shared_options.validator.async_waiting++;
        
        var use_check_res = FieldVal.use_check(checks || [], shared_options, function(){
            if (shared_options.had_error) {
                if (shared_options.options.emit) {
                    shared_options.options.emit(undefined);
                }
            } else {
                if (shared_options.options.emit) {
                    shared_options.options.emit(shared_options.value);
                }
            }

            if (shared_options.return_missing) {
                finish(FieldVal.REQUIRED_ERROR);
                shared_options.validator.async_call_ended();
                return;
            }

            if(!shared_options.existing_validator){
                finish(shared_options.validator.end());
                shared_options.validator.async_call_ended();
                return;
            }

            finish(null);
            shared_options.validator.async_call_ended();
            return;
        });
        if(use_check_res===FieldVal.ASYNC){
            if(done){//The done callback isn't required
                finish = done;
            }
            return FieldVal.ASYNC;
        } 
        if(did_return){
            return to_return;
        } else {
            return FieldVal.ASYNC;
        }
    };

    FieldVal.required = function (required, flags) {//required defaults to true
        var check = function (value) {
            if (value === null || value === undefined) {
                if (required || required === undefined) {
                    return FieldVal.REQUIRED_ERROR;
                }

                return FieldVal.NOT_REQUIRED_BUT_MISSING;
            }
        };
        if (flags !== undefined) {
            flags.check = check;
            return flags;
        }
        return check;
    };

    FieldVal.type = function (desired_type, flags) {

        var required = (flags && flags.required !== undefined) ? flags.required : true;

        var check = function (value, emit) {

            var required_error = FieldVal.required(required)(value);

            if (required_error) {
                return required_error;
            }

            var value_and_type = FieldVal.get_value_and_type(value, desired_type, flags);

            var inner_desired_type = value_and_type.desired_type;
            var type = value_and_type.type;
            value = value_and_type.value;

            if (type !== inner_desired_type) {
                return FieldVal.create_error(FieldVal.INCORRECT_TYPE_ERROR, flags, inner_desired_type, type);
            }
            if (emit) {
                emit(value);
            }
        };

        if (flags !== undefined) {
            flags.check = check;
            return flags;
        }

        return check;
    };

    FieldVal.create_error = function (default_error, flags) {
        if (!flags) {
            return default_error.apply(null, Array.prototype.slice.call(arguments, 2));
        }
        if (default_error === FieldVal.MISSING_ERROR) {
            var missing_error_type = typeof flags.missing_error;

            /* istanbul ignore else */
            if (missing_error_type === 'function') {
                return flags.missing_error.apply(null, Array.prototype.slice.call(arguments, 2));
            } else if (missing_error_type === 'object') {
                return flags.missing_error;
            } else if (missing_error_type === 'string') {
                return {
                    error_message: flags.missing_error
                };
            }
        } else {
            var error_type = typeof flags.error;

            /* istanbul ignore else */
            if (error_type === 'function') {
                return flags.error.apply(null, Array.prototype.slice.call(arguments, 2));
            } else if (error_type === 'object') {
                return flags.error;
            } else if (error_type === 'string') {
                return {
                    error_message: flags.error
                };
            }
        }

        return default_error.apply(null, Array.prototype.slice.call(arguments, 2));
    };

    return FieldVal;
}).call();

/* istanbul ignore else */
if ('undefined' !== typeof module) {
    module.exports = FieldVal;
}
var BasicVal = (function(){

    /* istanbul ignore if */
    if((typeof require) === 'function'){
        FieldVal = require("fieldval");
    }

    if (!Array.prototype.indexOf) {
        Array.prototype.indexOf = function(searchElement, fromIndex) {
            var k;
            if (this == null) {
                throw new TypeError('"this" is null or not defined');
            }

            var O = Object(this);
            var len = O.length >>> 0;
            if (len === 0) {
                return -1;
            }
            var n = +fromIndex || 0;
            if (Math.abs(n) === Infinity) {
                n = 0;
            }
            if (n >= len) {
                return -1;
            }
            k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);
            while (k < len) {
                var kValue;
                if (k in O && O[k] === searchElement) {
                    return k;
                }
                k++;
            }
            return -1;
        };
    }

    var BasicVal = {
        errors: {
            too_short: function(min_len) {
                return {
                    error: 100,
                    error_message: "Length is less than " + min_len
                };
            },
            too_long: function(max_len) {
                return {
                    error: 101,
                    error_message: "Length is greater than " + max_len
                };
            },
            too_small: function(min_val) {
                return {
                    error: 102,
                    error_message: "Value is less than " + min_val
                };
            },
            too_large: function(max_val) {
                return {
                    error: 103,
                    error_message: "Value is greater than " + max_val
                };
            },
            not_in_list: function() {
                return {
                    error: 104,
                    error_message: "Value is not a valid choice"
                };
            },
            cannot_be_empty: function() {
                return {
                    error: 105,
                    error_message: "Value cannot be empty."
                };
            },
            no_prefix: function(prefix) {
                return {
                    error: 106,
                    error_message: "Value does not have prefix: " + prefix
                };
            },
            invalid_email: function() {
                return {
                    error: 107,
                    error_message: "Invalid email address format."
                };
            },
            invalid_url: function() {
                return {
                    error: 108,
                    error_message: "Invalid url format."
                };
            },
            incorrect_length: function(len){
                return {
                    error: 109,
                    error_message: "Length is not equal to " + len
                };
            },
            no_suffix: function(suffix) {
                return {
                    error: 110,
                    error_message: "Value does not have suffix: " + suffix
                };
            },
            //111 in DateVal
            //112 in DateVal
            not_equal: function(match){
                return {
                    error: 113,
                    error_message: "Not equal to " + match + ".",

                };
            },
            //114 in DateVal
            no_valid_option: function(){//Should be overriden in most cases
                return {
                    error: 115,
                    error_message: "None of the options were valid.",
                };
            },
            contains_whitespace: function(){
                return {
                    error: 116,
                    error_message: "Contains whitespace."
                };
            },
            must_start_with_letter: function(){
                return {
                    error: 117,
                    error_message: "Must start with a letter."
                };  
            },
            value_in_list: function() {
                return {
                    error: 104,
                    error_message: "Value not allowed"
                };
            }
        },
        equal_to: function(match, flags){
            var check = function(value) {
                if (value!==match) {
                    return FieldVal.create_error(BasicVal.errors.not_equal, flags, match);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        merge_required_and_flags: function(required, flags){
            if((typeof required)==="object"){
                flags = required;
            } else {
                if(!flags){
                    flags = {};
                }
                flags.required = required;
            }
            return flags;
        },
        integer: function(required, flags){
            return FieldVal.type("integer",BasicVal.merge_required_and_flags(required, flags));
        },
        number: function(required, flags){
            return FieldVal.type("number",BasicVal.merge_required_and_flags(required, flags));
        },
        array: function(required, flags){
            return FieldVal.type("array",BasicVal.merge_required_and_flags(required, flags));
        },
        object: function(required, flags){
            return FieldVal.type("object",BasicVal.merge_required_and_flags(required, flags));
        },
        float: function(required, flags){
            return FieldVal.type("float",BasicVal.merge_required_and_flags(required, flags));
        },
        boolean: function(required, flags){
            return FieldVal.type("boolean",BasicVal.merge_required_and_flags(required, flags));
        },
        string: function(required, flags){
            flags = BasicVal.merge_required_and_flags(required, flags);
            var check = function(value, emit) {

                var core_check = FieldVal.type("string",flags);
                if(typeof core_check === 'object'){
                    //Passing flags turns the check into an object
                    core_check = core_check.check;
                }

                //Passing emit means that the value can be changed
                var error = core_check(value,emit);
                if(error) return error;

                if(!flags || flags.trim!==false){//If not explicitly false
                    value = value.trim();
                }
                if (value.length === 0) {
                    if(required || required===undefined){
                        return FieldVal.REQUIRED_ERROR;
                    } else {
                        return FieldVal.NOT_REQUIRED_BUT_MISSING;
                    }
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        length: function(len, flags) {
            var check = function(value) {
                if (value.length!==len) {
                    return FieldVal.create_error(BasicVal.errors.incorrect_length, flags, len);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        min_length: function(min_len, flags) {
            var check = function(value) {
                if (value.length < min_len) {
                    return FieldVal.create_error(BasicVal.errors.too_short, flags, min_len);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        max_length: function(max_len, flags) {
            var check = function(value) {
                if (value.length > max_len) {
                    return FieldVal.create_error(BasicVal.errors.too_long, flags, max_len);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        no_whitespace: function(flags) {
            var check = function(value) {
                if (/\s/.test(value)){
                    return FieldVal.create_error(BasicVal.errors.contains_whitespace, flags, max_len);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        minimum: function(min_val, flags) {
            var check = function(value) {
                if (value < min_val) {
                    return FieldVal.create_error(BasicVal.errors.too_small, flags, min_val);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        maximum: function(max_val, flags) {
            var check = function(value) {
                if (value > max_val) {
                    return FieldVal.create_error(BasicVal.errors.too_large, flags, max_val);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        range: function(min_val, max_val, flags) {
            //Effectively combines minimum and maximum
            var check = function(value){
                if (value < min_val) {
                    return FieldVal.create_error(BasicVal.errors.too_small, flags, min_val);
                } else if (value > max_val) {
                    return FieldVal.create_error(BasicVal.errors.too_large, flags, max_val);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        one_of: function(array, flags) {
            var valid_values = [];
            if(Object.prototype.toString.call(array) === '[object Array]'){
                for(var i = 0; i < array.length; i++){
                    var option = array[i];
                    if((typeof option) === 'object'){
                        valid_values.push(option[0]);
                    } else {
                        valid_values.push(option);
                    }
                }
            } else {
                for(var k in array){
                    valid_values.push(k);
                }
            }
            var check = function(value) {
                if (valid_values.indexOf(value) === -1) {
                    return FieldVal.create_error(BasicVal.errors.not_in_list, flags);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        not_one_of: function(array, flags) {
            var valid_values = [];
            if(Object.prototype.toString.call(array) === '[object Array]'){
                for(var i = 0; i < array.length; i++){
                    var option = array[i];
                    if((typeof option) === 'object'){
                        valid_values.push(option[0]);
                    } else {
                        valid_values.push(option);
                    }
                }
            } else {
                for(var k in array){
                    valid_values.push(k);
                }
            }
            var check = function(value) {
                if (valid_values.indexOf(value) !== -1) {
                    return FieldVal.create_error(BasicVal.errors.value_in_list, flags);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        not_empty: function(trim, flags) {
            var check = function(value) {
                if (trim) {
                    if (value.trim().length === 0) {
                        if(typeof flags.error){
                        }
                        return FieldVal.create_error(BasicVal.errors.cannot_be_empty, flags);
                    }
                } else {
                    if (value.length === 0) {
                        return FieldVal.create_error(BasicVal.errors.cannot_be_empty, flags);
                    }
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        prefix: function(prefix, flags) {
            var check = function(value) {
                if (value.length >= prefix.length) {
                    if (value.substring(0, prefix.length) != prefix) {
                        return FieldVal.create_error(BasicVal.errors.no_prefix, flags, prefix);
                    }
                } else {
                    return FieldVal.create_error(BasicVal.errors.no_prefix, flags, prefix);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        start_with_letter: function(flags) {
            var check = function(value) {
                if (value.length > 0) {
                    var char_code = value.charCodeAt(0);
                    if( !((char_code >= 65 && char_code <= 90) || (char_code >= 97 && char_code <= 122))){
                        return FieldVal.create_error(BasicVal.errors.must_start_with_letter, flags);
                    }
                } else {
                    return FieldVal.create_error(BasicVal.errors.must_start_with_letter, flags);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        suffix: function(suffix, flags) {
            var check = function(value) {
                if (value.length >= suffix.length) {
                    if (value.substring(value.length-suffix.length, value.length) != suffix) {
                        return FieldVal.create_error(BasicVal.errors.no_suffix, flags, suffix);
                    }
                } else {
                    return FieldVal.create_error(BasicVal.errors.no_suffix, flags, suffix);
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        each: function(on_each, flags) {
            var check = function(array, stop) {
                var validator = new FieldVal(null);
                for (var i = 0; i < array.length; i++) {
                    var value = array[i];


                    var res = on_each(value,i);
                    if (res === FieldVal.REQUIRED_ERROR){
                        validator.missing("" + i);
                    } else if (res != null) {
                        validator.invalid("" + i, res);
                    }
                }
                var error = validator.end();
                if(error!=null){
                    return error;
                }
            }
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        each_async: function(on_each, flags) {
            var check = function(array, emit, callback) {
                
                var validator = new FieldVal(null);
                var i = 0;
                var do_possible = function(){
                    i++;
                    if(i>array.length){
                        callback(validator.end());
                        return;
                    }
                    var value = array[i-1];

                    FieldVal.use_checks(value, [function(value, emit){
                        on_each(value,i,emit,callback);
                    }], {
                        field_name: ""+i,
                        validator: validator,
                        emit: function(emitted_value){
                            array[i-1] = emitted_value;
                        }
                    }, function(response){
                        if (response !== undefined) {
                            validator.invalid("" + i, response);
                        }
                        do_possible();
                    });
                }
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        multiple: function(possibles, flags){

            possibles = possibles || [];
            if(possibles.length===0){
                console.error("BasicVal.multiple called without possibles.");
            }
            
            var check = function(value, emit){
                for(var i = 0; i < possibles.length; i++){
                    var option = possibles[i];
            
                    var emitted_value;
                    var option_error = FieldVal.use_checks(value, option, null, null, function(emitted){
                        emitted_value = emitted;
                    })
                    if(!option_error){
                        if(emitted_value!==undefined){
                            emit(emitted_value);
                        }
                        return null;
                    }
                }
                return FieldVal.create_error(BasicVal.errors.no_valid_option, flags);
            }
            if(flags){
                flags.check = check;
                return flags
            }
            return {
                check: check
            }
        },
        multiple_async: function(possibles, flags){

            possibles = possibles || [];
            if(possibles.length===0){
                console.error("BasicVal.multiple_async called without possibles.");
                return;
            }

            var to_return;
            var check = function(value, emit, callback){
                var emitted_value;
                var emit_for_check = function(emitted){
                    emitted_value = emitted;
                };
                var i = 0;
                var do_possible = function(){
                    i++;
                    if(i>possibles.length){
                        callback(FieldVal.create_error(BasicVal.errors.no_valid_option, flags));
                        return;
                    }
                    var option = possibles[i-1];

                    FieldVal.use_checks(value, option, {
                        field_name: null,
                        validator: null,
                        emit: emit_for_check
                    }, function(response){
                        if(response===undefined){
                            callback(undefined);//Success
                        } else {
                            do_possible();
                        }
                    });
                }
                do_possible();
                return to_return;
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        email: function(flags){
            var check = function(value) {
                var re = BasicVal.email_regex;
                if(!re.test(value)){
                    return FieldVal.create_error(BasicVal.errors.invalid_email, flags);
                } 
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        },
        url: function(flags){
            var check = function(value) {
                var re = BasicVal.url_regex;
                if(!re.test(value)){
                    return FieldVal.create_error(BasicVal.errors.invalid_url, flags);
                } 
            };
            if(flags){
                flags.check = check;
                return flags;
            }
            return {
                check: check
            };
        }
    };

    BasicVal.email_regex = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    BasicVal.url_regex = /^(https?):\/\/(((([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]))|((([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])))(:[1-9][0-9]+)?(\/)?([\/?].+)?$/;

    return BasicVal;
}).call();

if (typeof module != 'undefined') {
    module.exports = BasicVal;
}
if((typeof require) === 'function'){
    FieldVal = require("fieldval");
    BasicVal = require("fieldval-basicval");
}

var DateVal = {
	errors: {
        invalid_date_format: function() {
            return {
                error: 111,
                error_message: "Invalid date format."
            };
        },
        invalid_date: function() {
            return {
                error: 112,
                error_message: "Invalid date."
            };
        },
        invalid_date_format_string: function(){
            return {
                error: 114,
                error_message: "Invalid date format string."
            };
        }
    },
	date_format: function(flags){

        var check = function(format, emit) {

            var format_array = [];

            var f = 0;
            var error = false;
            while(f < format.length && !error){
                var handled = false;
                for(var c in DateVal.date_components){
                    var substring = format.substring(f,f+c.length);
                    if(substring===c){
                        format_array.push(c);
                        f += c.length;
                        handled = true;
                        break;
                    }
                }
                if(!handled){
                    error = true;
                }
            }

            if(error){
                return FieldVal.create_error(DateVal.errors.invalid_date_format_string, flags);
            } else {
                emit(format_array);
            }
        };
        if(flags){
            flags.check = check;
            return flags;
        }
        return {
            check: check
        };
    },
    date_with_format_array: function(date, format_array){
        //Takes a Javascript Date object

        var date_string = "";

        for(var i = 0; i < format_array.length; i++){
            var component = format_array[i];
            var component_value = DateVal.date_components[component];
            if(component_value===0){
                date_string+=component;
            } else {
                var value_in_date;
                if(component==='yyyy'){
                    value_in_date = date.getUTCFullYear();
                } else if(component==='yy'){
                    value_in_date = date.getUTCFullYear().toString().substring(2);
                } else if(component==='MM' || component==='M'){
                    value_in_date = date.getUTCMonth()+1;
                } else if(component==='dd' || component==='d'){
                    value_in_date = date.getUTCDate();
                } else if(component==='hh' || component==='h'){
                    value_in_date = date.getUTCHours();
                } else if(component==='mm' || component==='m'){
                    value_in_date = date.getUTCMinutes();
                } else if(component==='ss' || component==='s'){
                    value_in_date = date.getUTCSeconds();
                }

                date_string += DateVal.pad_to_valid(value_in_date.toString(), component_value);
            }
        }

        return date_string;
    },
    pad_to_valid: function(value, allowed){
        var appended = false;
        for(var k = 0; k < allowed.length; k++){
            var allowed_length = allowed[k];

            if(value.length <= allowed_length){
                var diff = allowed_length - value.length;
                for(var m = 0; m < diff; m++){
                    value = "0"+value;
                }
                return value;
            }
        }
        return value;
    },
	date: function(format, flags){

		flags = flags || {};

        var format_array;

        var format_error = DateVal.date_format().check(format, function(emit_format_array){
            format_array = emit_format_array;
        });
        
        if(format_error){
            if(console.error){
                console.error(format_error.error_message);
            }
        }

        var check = function(value, emit) {
            var values = {};
            var value_array = [];

            var i = 0;
            var current_component = null;
            var current_component_value = null;
            var component_index = -1;
            var error = false;
            while(i < value.length && !error){
                component_index++;
                current_component = format_array[component_index];
                current_component_value = DateVal.date_components[current_component];

                if(current_component_value===0){
                    //Expecting a particular delimiter
                    if(value[i]!==current_component){
                        error = true;
                        break;
                    } else {
                    	value_array.push(null);
                        i++;
                        continue;
                    }
                }

                var min = current_component_value[0];
                var max = current_component_value[current_component_value.length-1];

                var incremented = false;
                var numeric_string = "";
                for(var n = 0; n < max; n++){
                    var character = value[i + n];
                    if(character===undefined){
                        break;
                    }
                    var char_code = character.charCodeAt(0);
                    if(char_code < 48 || char_code > 57){
                        if(n===min){
                            //Stopped at min
                            break;
                        } else {
                            error = true;
                            break;
                        }
                    } else {
                        numeric_string+=character;
                    }
                }
                
                i += n;

                if(error){
                    break;
                }

                var int_val = parseInt(numeric_string);

                value_array.push(numeric_string);

                if(current_component==='yyyy' || current_component==='yy'){
                    values.year = int_val;
                } else if(current_component==='MM' || current_component==='M'){
                    values.month = int_val;
                } else if(current_component==='dd' || current_component==='d'){
                    values.day = int_val;
                } else if(current_component==='hh' || current_component==='h'){
                    values.hour = int_val;
                } else if(current_component==='mm' || current_component==='m'){
                    values.minute = int_val;
                } else if(current_component==='ss' || current_component==='s'){
                    values.second = int_val;
                }
            }

            if(error){
                return FieldVal.create_error(DateVal.errors.invalid_date_format, flags);
            }

            if(values.hour!==undefined && (values.hour < 0 || values.hour>23)){
            	return FieldVal.create_error(DateVal.errors.invalid_date, flags);
            }
            if(values.minute!==undefined && (values.minute < 0 || values.minute>59)){
            	return FieldVal.create_error(DateVal.errors.invalid_date, flags);
            }
            if(values.second!==undefined && (values.second < 0 || values.second>59)){
            	return FieldVal.create_error(DateVal.errors.invalid_date, flags);
            }

            if(values.month!==undefined){
                var month = values.month;
                if(month>12){
                    return FieldVal.create_error(DateVal.errors.invalid_date, flags);
                } else if(month<1){
                    return FieldVal.create_error(DateVal.errors.invalid_date, flags);
                }

                if(values.day){
                    var day = values.day;

                    if(day<1){
                        return FieldVal.create_error(DateVal.errors.invalid_date, flags);
                    }

                    if(values.year){
                        var year = values.year;
                        if(month==2){
                            if(year%400===0 || (year%100!==0 && year%4===0)){
                                if(day>29){
                                    return FieldVal.create_error(DateVal.errors.invalid_date, flags);
                                }
                            } else {
                                if(day>28){
                                    return FieldVal.create_error(DateVal.errors.invalid_date, flags);
                                }
                            }
                        }
                    }
    
                    if(month===4 || month===6 || month===9 || month===11){
                        if(day > 30){
                            return FieldVal.create_error(DateVal.errors.invalid_date, flags);
                        }
                    } else if(month===2){
                        if(day > 29){
                            return FieldVal.create_error(DateVal.errors.invalid_date, flags);
                        }
                    } else {
                        if(day > 31){
                            return FieldVal.create_error(DateVal.errors.invalid_date, flags);
                        }
                    }
                }
            } else {
                //Don't have month, but days shouldn't be greater than 31 anyway
                if(values.day){
                    if(values.day > 31){
                        return FieldVal.create_error(DateVal.errors.invalid_date, flags);
                    } else if(values.day < 1){
                        return FieldVal.create_error(DateVal.errors.invalid_date, flags);
                    }
                }
            }

            if(flags.emit){
            	if(flags.emit === DateVal.EMIT_COMPONENT_ARRAY){
            		emit(value_array);
            	} else if(flags.emit === DateVal.EMIT_OBJECT){
                    emit(values);
                } else if(flags.emit === DateVal.EMIT_DATE){
                    var date = new Date(0);//Start with Jan 1st 1970
                    date.setUTCFullYear(0);

                    if(values.year!==undefined){
                        date.setYear(values.year);
                    }
                    if(values.month!==undefined){
                        date.setUTCMonth(values.month-1);
                    }
                    if(values.day!==undefined){
                        date.setUTCDate(values.day);
                    }
                    if(values.hour!==undefined){
                        date.setUTCHours(values.hour);
                    }
                    if(values.minute!==undefined){
                        date.setUTCMinutes(values.minute);
                    }
                    if(values.second!==undefined){
                        date.setUTCSeconds(values.second);
                    }

                    emit(date);
                }
            }

            //SUCCESS
            return;
        };
        if(flags){
            flags.check = check;
            return flags;
        }
        return {
            check: check
        };
    }
};

//Constants used for emit settings
DateVal.EMIT_COMPONENT_ARRAY = {};
DateVal.EMIT_DATE = {};
DateVal.EMIT_OBJECT = {};

DateVal.date_components = {
    "yyyy": [4],
    "yy": [2],
    "MM": [2],
    "M": [1,2],
    "dd": [2],
    "d": [1,2],
    "hh": [2],
    "h": [1,2],
    "mm": [2],
    "m": [1,2],
    "ss": [2],
    "s": [1,2],
    " ": 0,
    "-": 0,
    "/": 0,
    ":": 0
};

if (typeof module != 'undefined') {
    module.exports = DateVal;
}
//Used to subclass Javascript classes
function extend(sub, sup) {
	function emptyclass() {}
	emptyclass.prototype = sup.prototype;
	var empty_instance = new emptyclass();
	for(var i in empty_instance){
		sub.prototype[i] = empty_instance[i];
	}
	sub.prototype.constructor = sub;
	sub.superConstructor = sup;
	sub.superClass = sup.prototype;
}

if (typeof module != 'undefined') {
    module.exports = extend;
}

function RuleField(json, validator) {
    var field = this;

    field.json = json;
    field.checks = [];
    field.validator = (typeof validator != 'undefined') ? validator : new FieldVal(json);

    field.name = field.validator.get("name", BasicVal.string(false));
    field.display_name = field.validator.get("display_name", BasicVal.string(false));
    field.description = field.validator.get("description", BasicVal.string(false));
    field.type = field.validator.get("type", BasicVal.string(true));
    field.required = field.validator.default_value(true).get("required", BasicVal.boolean(false))

    if (json != null) {
        var exists = field.validator.get("exists", BasicVal.boolean(false));
        if (exists != null) {
            existsFilter = exists ? 1 : 2;
        }
    }
}

RuleField.types = {};

RuleField.add_field_type = function(field_type_data){
    RuleField.types[field_type_data.name] = {
        display_name: field_type_data.display_name,
        class: field_type_data.class
    }
}

RuleField.create_field = function(json, options) {
    var field = null;

    var error = BasicVal.object(true).check(json); 
    if(error){
        return [error, null];
    }

    var validator = new FieldVal(json);

    if(options && options.need_name!==undefined && options.need_name===true){
        var name_checks = [BasicVal.string(true)]
        if(options.existing_names){
            name_checks.push(BasicVal.not_one_of(options.existing_names, {
                error: {
                    "error": 1000,
                    "error_message": "Name already used"
                }
            }));
        }
        validator.get("name", name_checks);
    } 

    var type = validator.get("type", BasicVal.string(true), BasicVal.one_of(RuleField.types));

    if(type){
        var field_type_data = RuleField.types[type];
        var field_class = field_type_data.class;
        field = new field_class(json, validator)
    } else {
        return [validator.end(), null];
    }

    var init_res = field.init();
    if (init_res != null) {
        return [init_res, null];
    }

    return [null, field];
}

RuleField.prototype.validate_as_field = function(name, validator){
    var field = this;
    
    var value = validator.get(name, field.checks);

    return value;
}

RuleField.prototype.validate = function(value){
    var field = this;

    var validator = new FieldVal(null);

    var error = FieldVal.use_checks(value, field.checks);
    if(error){
        validator.error(error);
    }

    return validator.end();
}

RuleField.prototype.make_nested = function(){}
RuleField.prototype.init = function(){}
RuleField.prototype.remove = function(){}
RuleField.prototype.view_mode = function(){}
RuleField.prototype.edit_mode = function(){}
RuleField.prototype.change_name = function(name) {}
RuleField.prototype.disable = function() {}
RuleField.prototype.enable = function() {}
RuleField.prototype.focus = function() {}
RuleField.prototype.blur = function() {}
RuleField.prototype.val = function(set_val) {}

if (typeof module != 'undefined') {
    module.exports = RuleField;
}
if((typeof require) === 'function'){
    extend = require('extend')
}
extend(BasicRuleField, RuleField);

function BasicRuleField(json, validator) {
    var field = this;

    BasicRuleField.superConstructor.call(this, json, validator);
}

BasicRuleField.prototype.init = function(){
    var field = this;
    return field.ui_field.init.apply(field.ui_field, arguments);    
}
BasicRuleField.prototype.remove = function(){
    var field = this;
    return field.ui_field.remove.apply(field.ui_field, arguments);
}
BasicRuleField.prototype.in_array = function(){
    var field = this;
    return field.ui_field.in_array.apply(field.ui_field, arguments);
}
BasicRuleField.prototype.view_mode = function(){
    var field = this;
    return field.ui_field.view_mode.apply(field.ui_field, arguments);    
}
BasicRuleField.prototype.edit_mode = function(){
    var field = this;
    return field.ui_field.edit_mode.apply(field.ui_field, arguments);
}
BasicRuleField.prototype.change_name = function(name) {
    var field = this;
    return field.ui_field.change_name.apply(field.ui_field, arguments);
}
BasicRuleField.prototype.disable = function() {
    var field = this;
    return field.ui_field.disable.apply(field.ui_field, arguments);
}
BasicRuleField.prototype.val = function(){
    var field = this;
    return field.ui_field.val.apply(field.ui_field, arguments);
}
BasicRuleField.prototype.error = function(){
    var field = this;
    return field.ui_field.error.apply(field.ui_field, arguments);
}
BasicRuleField.prototype.blur = function(){
    var field = this;
    return field.ui_field.blur.apply(field.ui_field, arguments);
}
BasicRuleField.prototype.focus = function(){
    var field = this;
    return field.ui_field.blur.apply(field.ui_field, arguments);
}

if (typeof module != 'undefined') {
    module.exports = BasicRuleField;
}

if((typeof require) === 'function'){
    extend = require('extend')
    BasicRuleField = require('./BasicRuleField');
}
extend(TextRuleField, BasicRuleField);

function TextRuleField(json, validator) {
    var field = this;

    TextRuleField.superConstructor.call(this, json, validator);
}

TextRuleField.prototype.create_ui = function(parent){
    var field = this;

    field.ui_field = new TextField(field.display_name || field.name, field.json);
    field.element = field.ui_field.element;
    parent.add_field(field.name, field);
    return field.ui_field;
}

TextRuleField.prototype.init = function() {
    var field = this;

    field.checks.push(BasicVal.string(field.required));

    field.min_length = field.validator.get("min_length", BasicVal.integer(false));
    if(field.min_length !== undefined){
        field.checks.push(BasicVal.min_length(field.min_length,{stop_on_error:false}));
    }

    field.max_length = field.validator.get("max_length", BasicVal.integer(false));
    if(field.max_length !== undefined){
        field.checks.push(BasicVal.max_length(field.max_length,{stop_on_error:false}));
    }

    field.phrase = field.validator.get("phrase", BasicVal.string(false));
    field.equal_to = field.validator.get("equal_to", BasicVal.string(false));
    field.ci_equal_to = field.validator.get("ci_equal_to", BasicVal.string(false));
    field.prefix = field.validator.get("prefix", BasicVal.string(false));
    field.ci_prefix = field.validator.get("ci_prefix", BasicVal.string(false));
    field.query = field.validator.get("query", BasicVal.string(false));
    
    return field.validator.end();
}

if (typeof module != 'undefined') {
    module.exports = TextRuleField;
}
if((typeof require) === 'function'){
    extend = require('extend')
    BasicRuleField = require('./BasicRuleField');
}
extend(NumberRuleField, BasicRuleField);

function NumberRuleField(json, validator) {
    var field = this;

    NumberRuleField.superConstructor.call(this, json, validator);
}

NumberRuleField.prototype.create_ui = function(parent){
    var field = this;

    field.ui_field = new TextField(field.display_name || field.name, field.json);
    field.element = field.ui_field.element;
    parent.add_field(field.name, field);
    return field.ui_field;
}

NumberRuleField.prototype.init = function() {
    var field = this;

    field.checks.push(BasicVal.number(field.required));

    field.minimum = field.validator.get("minimum", BasicVal.number(false));
    if (field.minimum != null) {
        field.checks.push(BasicVal.minimum(field.minimum,{stop_on_error:false}));
    }

    field.maximum = field.validator.get("maximum", BasicVal.number(false));
    if (field.maximum != null) {
        field.checks.push(BasicVal.maximum(field.maximum,{stop_on_error:false}));
    }

    field.integer = field.validator.get("integer", BasicVal.boolean(false));
    if (field.integer) {
        field.checks.push(BasicVal.integer(false,{stop_on_error:false}));
    }

    return field.validator.end();
}

if (typeof module != 'undefined') {
    module.exports = NumberRuleField;
}
if((typeof require) === 'function'){
    extend = require('extend')
    BasicRuleField = require('./BasicRuleField');
}
extend(ObjectRuleField, BasicRuleField);

function ObjectRuleField(json, validator) {
    var field = this;

    ObjectRuleField.superConstructor.call(this, json, validator);
}

ObjectRuleField.prototype.create_ui = function(parent, form){
    var field = this;

    if(field.json.any){
        field.ui_field = new TextField(field.display_name || field.name, {type: 'textarea'});//Empty options

        field.ui_field.val = function(set_val){//Override the .val function
            var ui_field = this;
            if (arguments.length===0) {
                var value = ui_field.input.val();
                if(value.length===0){
                    return null;
                }
                try{
                    return JSON.parse(value);
                } catch (e){
                    console.error("FAILED TO PARSE: ",value);
                }
                return value;
            } else {
                ui_field.input.val(JSON.stringify(set_val,null,4));
                return ui_field;
            }
        }
        field.element = field.ui_field.element;
    } else {

        if(form){
            field.ui_field = form;
        } else {
            field.ui_field = new ObjectField(field.display_name || field.name, field.json);
        }

        for(var i in field.fields){
            var inner_field = field.fields[i];
            inner_field.create_ui(field.ui_field);
        }

        field.element = field.ui_field.element;
    }

    if(!form){
        parent.add_field(field.name, field.ui_field);
    }

    return field.ui_field;
}

ObjectRuleField.prototype.init = function() {
    var field = this;

    field.checks.push(BasicVal.object(field.required));

    field.fields = {};

    var fields_json = field.validator.get("fields", BasicVal.array(false));
    if (fields_json != null) {
        var fields_validator = new FieldVal(null);

        //TODO prevent duplicate name keys

        for (var i = 0; i < fields_json.length; i++) {
            var field_json = fields_json[i];

            var field_creation = RuleField.create_field(
                field_json,
                {
                    need_name: true,
                    existing_names: field.fields
                }
            );
            var err = field_creation[0];
            var nested_field = field_creation[1];

            if(err!=null){
                fields_validator.invalid(i,err);
                continue;
            }

            field.fields[nested_field.name] = nested_field;
        }

        var fields_error = fields_validator.end();
        if(fields_error!=null){
            field.validator.invalid("fields",fields_error);
        }
    }

    field.any = field.validator.get("any", BasicVal.boolean(false));
    if(!field.any){
        field.checks.push(function(value,emit){

            var inner_validator = new FieldVal(value);

            for(var i in field.fields){
                var inner_field = field.fields[i];
                inner_field.validate_as_field(i, inner_validator);
            }

            var inner_error = inner_validator.end();

            return inner_error;
        });
    }    

    return field.validator.end();
}

if (typeof module != 'undefined') {
    module.exports = ObjectRuleField;
}
if((typeof require) === 'function'){
    extend = require('extend')
    BasicRuleField = require('./BasicRuleField');
    ValidationRule = require('../ValidationRule');
}
extend(ArrayRuleField, BasicRuleField);

function ArrayRuleField(json, validator) {
    var field = this;

    ArrayRuleField.superConstructor.call(this, json, validator);

    field.rules = [];
    field.fields = [];
    field.interval = null;
    field.interval_offsets = [];
}

ArrayRuleField.prototype.create_ui = function(parent, form){
    var field = this;

    field.ui_field = new ArrayField(field.display_name || field.name, field.json);
    field.ui_field.new_field = function(index){
        return field.new_field(index);
    }
    var original_remove_field = field.ui_field.remove_field;
    field.ui_field.remove_field = function(inner_field){
        for(var i = 0; i < field.fields.length; i++){
            if(field.fields[i]===inner_field){
                field.fields.splice(i,1);
            }
        }
        return original_remove_field.call(field.ui_field, inner_field);
    }
    field.element = field.ui_field.element;
    parent.add_field(field.name, field);
    return field.ui_field;
}

ArrayRuleField.prototype.new_field = function(index){
    var field = this;

    var rule = field.rule_for_index(index);
    
    return rule.create_ui(field.ui_field);
}

ArrayRuleField.prototype.rule_for_index = function(index){
    var field = this;

    var rule = field.rules[index];
    if(!rule){
        var rule_json = field.rule_json_for_index(index);
        var field_creation = RuleField.create_field(rule_json);
        var err = field_creation[0];
        rule = field_creation[1];
        field.rules[index] = rule;
    }
    return rule;
}

ArrayRuleField.prototype.rule_json_for_index = function(index){
    var field = this;

    var rule_json = field.indices[index];
    if(!rule_json){
        if(field.interval){
            var offset = index % field.interval;
            rule_json = field.interval_offsets[offset];
        }
    }
    if(!rule_json){
        rule_json = field.indices["*"];
    }

    return rule_json;
}

ArrayRuleField.integer_regex = /^(\d+)$/;
ArrayRuleField.interval_regex = /^(\d+)n(\+(\d+))?$/;
ArrayRuleField.prototype.init = function() {
    var field = this;

    field.checks.push(BasicVal.array(field.required));

    field.indices = {};

    var indices_json = field.validator.get("indices", BasicVal.object(false));

    if (indices_json != null) {
        var indices_validator = new FieldVal(null);

        for(var index_string in indices_json){
        	var field_json = indices_json[index_string];

            //RuleField is created to validate properties, not to use
        	var field_creation = RuleField.create_field(field_json);
            var err = field_creation[0];

            if(err!=null){
                indices_validator.invalid(index_string,err);
                continue;
            }

            var interval_match = index_string.match(ArrayRuleField.interval_regex);
            if(interval_match){
                //Matched
                var interval = interval_match[1];
                var offset = interval_match[3] || 0;
                if(field.interval && interval!==field.interval){
                    indices_validator.invalid(
                        index_string,
                        FieldVal.create_error(
                            ValidationRule.errors.interval_conflict,
                            {},
                            interval,
                            field.interval
                        )
                    );
                    continue;   
                }
                field.interval = interval;
                field.interval_offsets[offset] = field_json;
            } else {
                var integer_match = index_string.match(ArrayRuleField.integer_regex);
                if(integer_match){
                    var integer_index = integer_match[1];
                    field.indices[integer_index] = field_json;
                } else if(index_string==='*'){
                    field.indices['*'] = field_json;
                } else {
                    indices_validator.invalid(
                        index_string,
                        FieldVal.create_error(
                            ValidationRule.errors.invalid_indices_format,
                            {}
                        )
                    );
                }
            }
        }

        var indices_error = indices_validator.end();
        if(indices_error){
            field.validator.invalid("indices", indices_error)
        }
    }

    field.checks.push(function(value,emit){

        var array_validator = new FieldVal(value);

        for(var i = 0; i < value.length; i++){
            var rule = field.rule_for_index(i);

            rule.validate_as_field(i, array_validator);
        }

        var array_error = array_validator.end();

        return array_error;
    });

    return field.validator.end();
}

if (typeof module != 'undefined') {
    module.exports = ArrayRuleField;
}
if((typeof require) === 'function'){
    extend = require('extend')
    BasicRuleField = require('./BasicRuleField');
}
extend(ChoiceRuleField, BasicRuleField);

function ChoiceRuleField(json, validator) {
    var field = this;

    ChoiceRuleField.superConstructor.call(this, json, validator);
}

ChoiceRuleField.prototype.create_ui = function(parent){
    var field = this;

    field.json.choices = field.choices;

    field.ui_field = new ChoiceField(field.display_name || field.name, field.json);
    field.element = field.ui_field.element;
    parent.add_field(field.name, field);
    return field.ui_field;
}

ChoiceRuleField.prototype.init = function() {
    var field = this;

    field.allow_empty = field.validator.get("allow_empty", BasicVal.boolean(false));
    field.empty_message = field.validator.get("empty_message", BasicVal.string(false));
    field.choices = field.validator.get("choices", BasicVal.array(true));

    if(field.choices!==undefined){
        field.checks.push(BasicVal.one_of(field.choices,{stop_on_error:false}));
    }

    return field.validator.end();
}

if (typeof module != 'undefined') {
    module.exports = ChoiceRuleField;
}
if((typeof require) === 'function'){
    extend = require('extend')
    BasicRuleField = require('./BasicRuleField');
}
extend(BooleanRuleField, BasicRuleField);

function BooleanRuleField(json, validator) {
    var field = this;

    BooleanRuleField.superConstructor.call(this, json, validator);
}

BooleanRuleField.prototype.create_ui = function(parent){
    var field = this;

    field.ui_field = new BooleanField(field.display_name || field.name, field.json);
    field.element = field.ui_field.element;
    parent.add_field(field.name, field);
    return field.ui_field;
}

BooleanRuleField.prototype.init = function() {
    var field = this;

    field.checks.push(BasicVal.boolean(field.required));

    field.equal_to = field.validator.get("equal_to", BasicVal.boolean(false));
    if(field.equal_to !== undefined){
        field.checks.push(BasicVal.equal_to(field.equal_to));
    }
    
    return field.validator.end();
}

if (typeof module != 'undefined') {
    module.exports = BooleanRuleField;
}
if((typeof require) === 'function'){
    extend = require('extend')
    BasicRuleField = require('./BasicRuleField');
}
extend(EmailRuleField, BasicRuleField);

function EmailRuleField(json, validator) {
    var field = this;

    EmailRuleField.superConstructor.call(this, json, validator);
}

EmailRuleField.prototype.create_ui = function(parent){
    var field = this;

    field.ui_field = new TextField(field.display_name || field.name, field.json);
    field.element = field.ui_field.element;
    parent.add_field(field.name, field);
    return field.ui_field;
}

EmailRuleField.prototype.init = function() {
    var field = this;

    field.checks.push(BasicVal.string(field.required), BasicVal.email());
    
    return field.validator.end();
}

if (typeof module != 'undefined') {
    module.exports = EmailRuleField;
}

if((typeof require) === 'function'){
    FieldVal = require('fieldval')
    BasicVal = require('fieldval-basicval')
    RuleField = require('./fields/RuleField');
}

function ValidationRule() {
    var vr = this;
}

ValidationRule.errors = {
    interval_conflict: function(this_interval, existing_interval) {
        return {
            error: 501,
            error_message: "Only one interval can be used.",
            interval: this_interval,
            existing: existing_interval
        }
    },
    invalid_indices_format: function(){
        return {
            error: 502,
            error_message: "Invalid format for an indices rule."
        }    
    }
}

ValidationRule.RuleField = RuleField;

//Performs validation required for saving
ValidationRule.prototype.init = function(json, options) {
    var vr = this;

    var field_res = RuleField.create_field(json, options);

    //There was an error creating the field
    if(field_res[0]){
        return field_res[0];
    }

    //Keep the created field
    vr.field = field_res[1];
    return null;
}

ValidationRule.prototype.create_form = function(){
    var vr = this;

    if(FVForm){
        var form = new FVForm();
        vr.field.create_ui(form,form);
        return form;
    }
}

ValidationRule.prototype.validate = function(value) {
    var vr = this;

    var error = vr.field.validate(value);

    return error;
}

if (typeof module != 'undefined') {
    module.exports = ValidationRule;
}

RuleField.add_field_type({
    name: 'text',
    display_name: 'Text',
    class: (typeof TextRuleField) !== 'undefined' ? TextRuleField : require('./fields/TextRuleField')
});
RuleField.add_field_type({
    name: 'string',
    display_name: 'String',
    class: (typeof TextRuleField) !== 'undefined' ? TextRuleField : require('./fields/TextRuleField')
});
RuleField.add_field_type({
    name: 'boolean',
    display_name: 'Boolean',
    class: (typeof BooleanRuleField) !== 'undefined' ? BooleanRuleField : require('./fields/BooleanRuleField')
});
RuleField.add_field_type({
    name: 'number',
    display_name: 'Number',
    class: (typeof NumberRuleField) !== 'undefined' ? NumberRuleField : require('./fields/NumberRuleField')
});
RuleField.add_field_type({
    name: 'object',
    display_name: 'Object',
    class: (typeof ObjectRuleField) !== 'undefined' ? ObjectRuleField : require('./fields/ObjectRuleField')
});
RuleField.add_field_type({
    name: 'array',
    display_name: 'Array',
    class: (typeof ArrayRuleField) !== 'undefined' ? ArrayRuleField : require('./fields/ArrayRuleField')
});
RuleField.add_field_type({
    name: 'choice',
    display_name: 'Choice',
    class: (typeof ChoiceRuleField) !== 'undefined' ? ChoiceRuleField : require('./fields/ChoiceRuleField')
});
RuleField.add_field_type({
    name: 'email',
    display_name: 'Email',
    class: (typeof EmailRuleField) !== 'undefined' ? EmailRuleField : require('./fields/EmailRuleField')
});
//Used to subclass Javascript classes
function fieldval_ui_extend(sub, sup) {
	function emptyclass() {}
	emptyclass.prototype = sup.prototype;
	sub.prototype = new emptyclass();
	sub.prototype.constructor = sub;
	sub.superConstructor = sup;
	sub.superClass = sup.prototype;
}
function FVForm(fields){
	var form = this;

	form.element = $("<form />").addClass("fv_form").append(
		form.error_message = $("<div />").addClass("fv_error_message").hide()
	).on("submit",function(event){
        event.preventDefault();
        form.submit();
        return false;
	});

	form.fields = fields || {};

	//Used because ObjectField uses some FVForm.prototype functions
	form.fields_element = form.element;

	form.submit_callbacks = [];
}
FVForm.button_event = 'click';

FVForm.prototype.init = function(){
	var form = this;

	for(var i in form.fields){
        var inner_field = form.fields[i];
        inner_field.init();
    }
}

FVForm.prototype.remove = function(){
	var form = this;

	for(var i in form.fields){
        var inner_field = form.fields[i];
        inner_field.remove();
    }
}

FVForm.prototype.blur = function() {
    var form = this;

    for(var i in form.fields){
        var inner_field = form.fields[i];
        inner_field.blur();
    }

    return form;
}

FVForm.prototype.edit_mode = function(callback){
	var form = this;

	for(var i in form.fields){
		form.fields[i].edit_mode();
	}

	return form;
}

FVForm.prototype.view_mode = function(callback){
	var form = this;

	for(var i in form.fields){
		form.fields[i].view_mode();
	}

	return form;
}

FVForm.prototype.on_submit = function(callback){
	var form = this;

	form.submit_callbacks.push(callback);

	return form;
}

FVForm.prototype.submit = function(){
	var form = this;

	var compiled = form.val();

	for(var i = 0; i < form.submit_callbacks.length; i++){
		var callback = form.submit_callbacks[i];

		callback(compiled);
	}

	//returns compiled as well as invoking callback
	return compiled;
}

FVForm.prototype.add_field = function(name, field){
	var form = this;

    field.element.appendTo(form.fields_element);
    form.fields[name] = field;

    return form;
}

FVForm.prototype.remove_field = function(name){
	var form = this;

    var field = form.fields[name];
    if(field){
    	field.remove();//Field class will perform field.element.remove()
    	delete form.fields[name];
    }
}

//Same as FVForm.error(null)
FVForm.prototype.clear_errors = function(){
	var form = this;
	form.error(null);
}

FVForm.prototype.fields_error = function(error){
	var form = this;

	if(error){
	    var invalid_fields = error.invalid || {};
	    var missing_fields = error.missing || {};
	    var unrecognized_fields = error.unrecognized || {};
	    
	    for(var i in form.fields){
	    	var field = form.fields[i];

	    	var field_error = invalid_fields[i] || missing_fields[i] || unrecognized_fields[i] || null;
    		field.error(field_error);
	    }

	} else {
		for(var i in form.fields){
			var field = form.fields[i];
			field.error(null);
		}
	}
}

FVForm.prototype.show_error = function(){
    var form = this;
    form.error_message.show();
}

FVForm.prototype.hide_error = function(){
    var form = this;
    form.error_message.hide();
}

FVForm.prototype.error = function(error) {
    var form = this;

    form.error_message.empty();

    if(error){

    	if(error.error===undefined){
    		console.error("No error provided");
    		return;
    	}

    	if(error.error===0){
        	form.fields_error(error);
        	form.hide_error();
        } else {
        	if(error.error===4){
	            var error_list = $("<ul />");
	            for(var i = 0; i < error.errors.length; i++){
	                var sub_error = error.errors[i];
	                if(sub_error.error===0){
	                	form.fields_error(sub_error);
	                } else {
		                error_list.append(
		                    $("<li />").text(sub_error.error_message)
		                )
		            }
	            }
	            form.error_message.append(
	                error_list
	            );
	        } else {
	        	form.error_message.append(
	                $("<span />").text(error.error_message)
	            )
	        }
	        form.show_error();
		}
    } else {
    	//Clear error
    	form.fields_error(null);
    	form.hide_error();
    }
}

FVForm.prototype.disable = function(){
	var form = this;

	for(var i in form.fields){
		var field = form.fields[i];
		field.disable();
	}
}

FVForm.prototype.enable = function(){
	var form = this;

	for(var i in form.fields){
		var field = form.fields[i];
		field.enable();
	}	
}

FVForm.prototype.val = function(set_val){
    var form = this;

    if (arguments.length===0) {
        var output = {};
		for(var i in form.fields){
			var field = form.fields[i];
			if(field.show_on_form_flag!==false){
				var value = field.val();
				if(value!=null){
					output[i] = value;
				}
			}
		}
		return output;
    } else {
    	if(set_val){
	    	for(var i in form.fields){
	    		var field = form.fields[i];
	    		field.val(set_val[i]);
	    	}
	    }
        return form;
    }
}
function Field(name, options) {
    var field = this;

    field.name = name;
    field.options = options || {};

    field.show_on_form_flag = true;
    field.is_in_array = false;

    field.on_change_callbacks = [];

    field.element = $("<div />").addClass("fv_field").data("field",field);
    field.title = $("<div />").addClass("fv_field_title").text(field.name)
    if(field.options.description){
        field.description_label = $("<div />").addClass("fv_field_description").text(field.options.description)
    }
    field.input_holder = $("<div />").addClass("fv_input_holder")
    field.error_message = $("<div />").addClass("fv_error_message").hide()

    field.layout();
}

Field.prototype.in_array = function(remove_callback){
    var field = this;

    field.is_in_array = true;

    field.element.addClass("fv_nested")
    .append(
        field.move_handle = $("<div />")
        .addClass("fv_field_move_handle")
        .html("&#8645;")
    ,
        field.remove_button = $("<button />")
        .addClass("fv_field_remove_button")
        .html("&#10060;").on(FVForm.button_event,function(event){
            event.preventDefault();
            remove_callback();
            field.remove();
        })
    )
}

Field.prototype.init = function(){
    var field = this;
}

Field.prototype.remove = function(){
    var field = this;

    field.element.remove();
}

Field.prototype.view_mode = function(){
    var field = this;

    if(field.is_in_array){
        field.remove_button.hide();
        field.move_handle.hide();
    }

    field.element.addClass("fv_view_mode")
    field.element.removeClass("fv_edit_mode")

    console.log("view_mode ",field);
}

Field.prototype.edit_mode = function(){
    var field = this;    

    if(field.is_in_array){
        field.remove_button.show();
        field.move_handle.show();
    }

    field.element.addClass("fv_edit_mode")
    field.element.removeClass("fv_view_mode")

    console.log("edit_mode ",field);
}

Field.prototype.change_name = function(name) {
    var field = this;
    field.name = name;
    return field;
}

Field.prototype.layout = function(){
    var field = this;

    field.element.append(
        field.title,
        field.description_label,
        field.input_holder,
        field.error_message
    )
}

Field.prototype.on_change = function(callback){
    var field = this;

    field.on_change_callbacks.push(callback);

    return field;
}

Field.prototype.hide_on_form = function(){
    var field = this;
    field.show_on_form_flag = false;
    return field;
}

Field.prototype.show_on_form = function(){
    var field = this;
    field.show_on_form_flag = true;
    return field;
}

Field.prototype.did_change = function(){
    var field = this;

    var val = field.val();

    for(var i = 0; i < field.on_change_callbacks.length; i++){
        var callback = field.on_change_callbacks[i];

        callback(val);
    }
    return field;
}

Field.prototype.icon = function(params) {
    var field = this;
}

Field.prototype.val = function(set_val) {
    console.error("Did not override Field.val()")
}

Field.prototype.disable = function() {
    var field = this;
}

Field.prototype.enable = function() {
    var field = this;
}

Field.prototype.blur = function() {
    var field = this;
}

Field.prototype.focus = function() {
    var field = this;
}

Field.prototype.show_error = function(){
    var field = this;
    field.error_message.show();
}

Field.prototype.hide_error = function(){
    var field = this;
    field.error_message.hide();
}

Field.prototype.error = function(error) {
    var field = this;

    if (error) {
        field.error_message.empty();
        if(error.error===4){
            var error_list = $("<ul />");
            for(var i = 0; i < error.errors.length; i++){
                var sub_error = error.errors[i];
                error_list.append(
                    $("<li />").text(sub_error.error_message)
                )
            }
            field.error_message.append(
                error_list
            );
        } else {
            field.error_message.append(
                $("<span />").text(error.error_message)
            )
        }
        if(field.element){
            field.element.addClass("fv_field_error");
        }
        field.show_error();
    } else {
        field.hide_error();
        if(field.element){
            field.element.removeClass("fv_field_error");
        }
    }
}
fieldval_ui_extend(TextField, Field);

function TextField(name, options) {
    var field = this;

    var options_type = typeof options;

    if(options_type === "string"){
        field.input_type = options;
        options = {};
    } else if(options_type === "object"){
        field.input_type = options.type || "text";
    } else {
        options = {};
    }

    TextField.superConstructor.call(this, name, options);

    field.element.addClass("fv_text_field");

    if(field.input_type==='textarea'){
        field.input = $("<textarea />")
    } else if(field.input_type==='text' || field.input_type==='number' || !field.input_type) {
        field.input = $("<input type='text' />")
    } else {
        field.input = $("<input type='"+field.input_type+"' />")
    }
    
    field.enter_callbacks = [];

    field.input.addClass("fv_text_input")
    .attr("placeholder", name)
    .on("keydown",function(e){
        if(e.keyCode===13){
            for(var i = 0; i < field.enter_callbacks.length; i++){
                field.enter_callbacks[i](e);
            }
        }
    })
    .on("keyup",function(){
        field.did_change()
    })
    .appendTo(field.input_holder);
}

TextField.prototype.on_enter = function(callback){
    var field = this;

    field.enter_callbacks.push(callback);
    
    return field;
}

TextField.prototype.view_mode = function(){
    var field = this;

    field.input.prop({
        "readonly": "readonly",
        "disabled": "disabled"
    })

    Field.prototype.view_mode.call(this);
}

TextField.prototype.edit_mode = function(){
    var field = this;

    field.input.prop({
        "readonly": null,
        "disabled": null
    })

    Field.prototype.edit_mode.call(this);
}

TextField.prototype.icon = function(params) {
    var field = this;

    var css_props = {
        'background-image': "url(" + params.background + ")",
        'background-position': params.position,
        'background-repeat': "no-repeat",
        'padding-left': params.width + "px"
    }

    field.input.css(css_props);
    return field;
}

TextField.prototype.change_name = function(name) {
    var field = this;

    TextField.superClass.change_name.call(this,name);

    field.input.attr("placeholder", name);
    return field;
}

TextField.prototype.disable = function() {
    var field = this;
    field.input.attr("disabled", "disabled");
    return field;
}

TextField.prototype.enable = function() {
    var field = this;
    field.input.attr("disabled", null);
    return field;
}

TextField.prototype.focus = function() {
    var field = this;
    field.input.focus();
    return field;
}

TextField.prototype.blur = function() {
    var field = this;
    field.input.blur();
    return field;
}

TextField.numeric_regex = /^\d+(\.\d+)?$/;

TextField.prototype.val = function(set_val) {
    var field = this;

    if (arguments.length===0) {
        var value = field.input.val();
        if(field.input_type==="number" && TextField.numeric_regex.test(value)){
            return parseFloat(value);
        }
        if(value.length===0){
            return null;
        }
        return value;
    } else {
        field.input.val(set_val);
        return field;
    }
}

fieldval_ui_extend(PasswordField, TextField);

function PasswordField(name) {
    var field = this;

    PasswordField.superConstructor.call(this, name, "password");
}
fieldval_ui_extend(DisplayField, Field);

function DisplayField(name, options) {
    var field = this;

    DisplayField.superConstructor.call(this, name, options);

    field.element.addClass("fv_display_field");

    field.input = $("<div />")
    .appendTo(field.input_holder);

    field.hide_on_form();
}

DisplayField.prototype.icon = function(params) {
    var field = this;

    var css_props = {
        'background-image': "url(" + params.background + ")",
        'background-position': params.position,
        'background-repeat': "no-repeat",
        'padding-left': params.width + "px"
    }

    field.input.css(css_props);
    return field;
}

DisplayField.prototype.change_name = function(name) {
    var field = this;

    DisplayField.superClass.change_name.call(this,name);

    return field;
}

DisplayField.replace_line_breaks = function(string){
    if(typeof string !== 'string'){
        return string;
    }
    var htmls = [];
    var lines = string.split(/\n/);
    var tmpDiv = jQuery(document.createElement('div'));
    for (var i = 0 ; i < lines.length ; i++) {
        htmls.push(tmpDiv.text(lines[i]).html());
    }
    return htmls.join("<br>");
}

DisplayField.prototype.val = function(set_val) {
    var field = this;

    if (arguments.length===0) {
        return field.input.text();
    } else {
        field.input.html(DisplayField.replace_line_breaks(set_val));
        return field;
    }
}
fieldval_ui_extend(ChoiceField, Field);

function ChoiceField(name, options) {
    var field = this;

    ChoiceField.superConstructor.call(this, name, options);

    field.choices = field.options.choices || [];
    field.allow_empty = field.options.allow_empty || false;

    field.element.addClass("fv_choice_field");

    field.select = $("<select/>")
    .addClass("fv_choice_input")
    .appendTo(field.input_holder);

    setTimeout(function(){
        field.select.on("change",function(){
            field.did_change()
        })
    },100)

    field.choice_values = [];

    if(field.allow_empty){
        field.empty_option = $("<option />").attr({
            "value": null
        }).text(field.options.empty_message || "")

        field.select.append(field.empty_option);
    }

    for(var i = 0; i < field.choices.length; i++){
        var choice = field.choices[i];

        var choice_value,choice_text;
        if((typeof choice)=="object"){
            choice_value = choice[0];
            choice_text = choice[1];
        } else {
            choice_value = choice_text = choice;
        }

        field.choice_values.push(choice_value);

        var option = $("<option />")
        .attr("value",choice_value)
        .text(choice_text)

        field.select.append(option);
    }
}

ChoiceField.prototype.disable = function() {
    var field = this;
    field.select.attr("disabled", "disabled");
    return field;
}

ChoiceField.prototype.enable = function() {
    var field = this;
    field.select.attr("disabled", null);
    return field;
}

ChoiceField.prototype.focus = function() {
    var field = this;
    field.select.focus();
    return field;
}

ChoiceField.prototype.blur = function() {
    var field = this;
    field.select.blur();
    return field;
}

ChoiceField.prototype.val = function(set_val) {
    var field = this;

    if (arguments.length===0) {
        var selected = field.select.find(":selected");
        var index = selected.index() - (field.allow_empty ? 1 : 0);
        if(field.allow_empty && index===-1){
            return null;
        }
        return field.choice_values[index];
    } else {
        if(set_val!==undefined){
            field.select.val(set_val);
        } else {
            if(field.allow_empty){
                field.select.val(field.empty_option);
            } else {
                field.select.val(field.choice_values[0]);
            }
        }
        return field;
    }
}
fieldval_ui_extend(DateField, Field);

function DateField(name, options) {//format is currently unused
    var field = this;

    if(typeof DateVal === 'undefined'){
        console.error("DateField requires fieldval-dateval-js");
        return;
    }

    DateField.superConstructor.call(this, name, options);

    field.element.addClass("fv_date_field");

    field.format_string = field.options.format || "yyyy-MM-dd";

    var format_error = DateVal.date_format().check(field.format_string, function(emit_format_array){
        field.format_array = emit_format_array;
    })
    
    if(format_error){
        console.error(format_error.error_message);
        return;
    }

    field.inputs = [];

    for(var i = 0; i < field.format_array.length; i++){

        var component = field.format_array[i];
        var component_value = DateVal.date_components[component];

        field.add_element_from_component(component, component_value);
    }
}

DateField.prototype.add_element_from_component = function(component, component_value){
    var field = this;

    if(component_value===0){
        var component_string = component;
        field.inputs.push(null);
        field.input_holder.append(
            $("<div />").addClass("fv_date_separator").text(component_string)
        )
    } else {
        var component_max_length = component_value[component_value.length-1];
        var input = $("<input />").attr({
            "placeholder": component,
            "size": component_max_length,
            "maxlength": component_max_length
        })
        .addClass("fv_date_input")
        .on("keyup",function(){
            field.did_change()
        })

        input.blur(function(){
            var input_val = input.val();
            var padded = DateVal.pad_to_valid(input_val, component_value);
            input.val(padded);
        })

        field.inputs.push(input);
        field.input_holder.append(input)
    }
}

DateField.prototype.icon = function(params) {
    var field = this;

    return field;
}

DateField.prototype.change_name = function(name) {
    var field = this;

    DateField.superClass.change_name.call(this,name);

    field.input.attr("placeholder", name);
    return field;
}

DateField.prototype.disable = function() {
    var field = this;
    for(var i = 0; i < field.inputs; i++){
        var input = field.inputs[i];
        if(input){
            input.attr("disabled", "disabled");
        }
    }
    return field;
}

DateField.prototype.enable = function() {
    var field = this;
    for(var i = 0; i < field.inputs; i++){
        var input = field.inputs[i];
        if(input){
            input.attr("disabled", null);
        }
    }
    return field;
}

DateField.prototype.focus = function() {
    var field = this;
    
    var input = field.inputs[0];
    if(input){
        input.blur();
    }

    return field;
}

DateField.prototype.blur = function() {
    var field = this;
    for(var i = 0; i < field.inputs; i++){
        var input = field.inputs[i];
        if(input){
            input.blur();
        }
    }
    return field;
}

DateField.prototype.val = function(set_val) {
    var field = this;

    if (arguments.length===0) {

        var date_string = "";
        for(var i = 0; i < field.format_array.length; i++){
            var component = field.format_array[i];
            var component_value = DateVal.date_components[component];
            if(component_value===0){
                date_string+=component;
            } else {
                var input = field.inputs[i];
                var input_val = input.val().toString();

                date_string += DateVal.pad_to_valid(input_val, component_value);
            }
        }

        return date_string;
    } else {

        if(set_val!=null){

            if(typeof set_val === 'number'){
                //Allows using a timestamp as an input value
                set_val = DateVal.date_with_format_array(new Date(set_val), field.format_array);
            } else if(set_val instanceof Date){
                //Allows using a Date as an input value
                set_val = DateVal.date_with_format_array(set_val, field.format_array);
            }

            var validation = DateVal.date(field.format_string, {
                "emit": DateVal.EMIT_COMPONENT_ARRAY
            }).check(set_val, function(emitted){
                as_components = emitted;
            })

            if(validation){
                console.error("Invalid format passed to .val of DateField");
                return;
            }

            for(var i = 0; i < field.format_array.length; i++){
                var component = field.format_array[i];
                var component_value = DateVal.date_components[component];
                if(component_value===0){
                    date_string+=component;
                } else {
                    var input = field.inputs[i];
                    input.val(as_components[i]);
                }
            }
        }

        return field;
    }
}
fieldval_ui_extend(BooleanField, Field);

function BooleanField(name, options) {
    var field = this;

    BooleanField.superConstructor.call(this, name, options);

    field.element.addClass("fv_boolean_field");

    field.input = $("<input type='checkbox' />")
    .addClass("fv_boolean_input")
    .on("change",function(){
        field.did_change()
    })
    .appendTo(field.input_holder);
}

BooleanField.prototype.disable = function() {
    var field = this;
    field.input.attr("disabled", "disabled");
    return field;
}

BooleanField.prototype.enable = function() {
    var field = this;
    field.input.attr("disabled", null);
    return field;
}

BooleanField.prototype.focus = function() {
    var field = this;
    field.input.focus();
    return field;
}

BooleanField.prototype.blur = function() {
    var field = this;
    field.input.blur();
    return field;
}

BooleanField.prototype.val = function(set_val) {
    var field = this;

    if (arguments.length===0) {
        return field.input.is(":checked")
    } else {
        if(set_val==="true"){
            set_val = true;
        } else if(set_val==="false"){
            set_val = false;
        }
       	field.input.prop('checked', set_val);
        return field;
    }
}
fieldval_ui_extend(ObjectField, Field);

function ObjectField(name, options) {
    var field = this;

    ObjectField.superConstructor.call(this, name, options);

    field.element.addClass("fv_object_field");

    field.fields_element = field.input_holder;

    field.fields = {};
}

ObjectField.prototype.init = function(){
    FVForm.prototype.init.call(this);
}

ObjectField.prototype.remove = function(){
    FVForm.prototype.remove.call(this);

    Field.prototype.remove.call(this);
}

ObjectField.prototype.add_field = function(name, field){
    FVForm.prototype.add_field.call(this,name,field);
}

ObjectField.prototype.change_name = function(name) {
    var field = this;
    ObjectField.superClass.change_name.call(this,name);
    return field;
}

ObjectField.prototype.view_mode = function(){
    var field = this;

    for(var i in field.fields){
        field.fields[i].view_mode();
    }

    Field.prototype.view_mode.call(this);
}

ObjectField.prototype.edit_mode = function(){
    var field = this;

    for(var i in field.fields){
        field.fields[i].edit_mode();
    }

    Field.prototype.edit_mode.call(this);
}

ObjectField.prototype.disable = function() {
    var field = this;
    return field;
}

ObjectField.prototype.enable = function() {
    var field = this;
    return field;
}

ObjectField.prototype.focus = function() {
    var field = this;
    return field;
}

ObjectField.prototype.blur = function() {
    var field = this;

    FVForm.prototype.blur.call(this);
}

ObjectField.prototype.error = function(error){
    var field = this;

    ObjectField.superClass.error.call(this,error);

    FVForm.prototype.error.call(this,error);
}

ObjectField.prototype.fields_error = function(error){
    var field = this;

    FVForm.prototype.fields_error.call(this,error);
}


ObjectField.prototype.clear_errors = function(){
	var field = this;

	FVForm.prototype.clear_errors.call(this);
}

ObjectField.prototype.val = function(set_val) {
    var field = this;

    if (arguments.length===0) {
    	var compiled = {};
    	for(var i in field.fields){
    		var inner_field = field.fields[i];
    		compiled[i] = inner_field.val();
    	}
        return compiled;
    } else {
    	for(var i in set_val){
    		var inner_field = field.fields[i];
            if(inner_field){
        		inner_field.val(set_val[i]);
            }
    	}
        return field;
    }
}
/*!
 * Nestable jQuery Plugin - Copyright (c) 2012 David Bushell - http://dbushell.com/
 * Dual-licensed under the BSD or MIT licenses
 */
;(function($, window, document, undefined)
{
    var hasTouch = 'ontouchstart' in document;

    /**
     * Detect CSS pointer-events property
     * events are normally disabled on the dragging element to avoid conflicts
     * https://github.com/ausi/Feature-detection-technique-for-pointer-events/blob/master/modernizr-pointerevents.js
     */
    var hasPointerEvents = (function()
    {
        var el    = document.createElement('div'),
            docEl = document.documentElement;
        if (!('pointerEvents' in el.style)) {
            return false;
        }
        el.style.pointerEvents = 'auto';
        el.style.pointerEvents = 'x';
        docEl.appendChild(el);
        var supports = window.getComputedStyle && window.getComputedStyle(el, '').pointerEvents === 'auto';
        docEl.removeChild(el);
        return !!supports;
    })();

    var defaults = {
            listNodeName    : 'ol',
            itemNodeName    : 'li',
            rootClass       : 'dd',
            listClass       : 'dd-list',
            itemClass       : 'dd-item',
            dragClass       : 'dd-dragel',
            handleClass     : 'dd-handle',
            collapsedClass  : 'dd-collapsed',
            placeClass      : 'dd-placeholder',
            noDragClass     : 'dd-nodrag',
            emptyClass      : 'dd-empty',
            expandBtnHTML   : '<button data-action="expand" type="button">Expand</button>',
            collapseBtnHTML : '<button data-action="collapse" type="button">Collapse</button>',
            group           : 0,
            maxDepth        : 5,
            threshold       : 20
        };

    function Plugin(element, options)
    {
        this.w  = $(document);
        this.el = $(element);
        this.options = $.extend({}, defaults, options);
        this.init();
    }

    Plugin.prototype = {

        init: function()
        {
            var list = this;

            list.reset();

            list.el.data('nestable-group', this.options.group);

            list.placeEl = $('<div class="' + list.options.placeClass + '"/>');

            $.each(this.el.find(list.options.itemNodeName), function(k, el) {
                list.setParent($(el));
            });

            list.el.on('click', 'button', function(e) {
                if (list.dragEl) {
                    return;
                }
                var target = $(e.currentTarget),
                    action = target.data('action'),
                    item   = target.parent(list.options.itemNodeName);
                if (action === 'collapse') {
                    list.collapseItem(item);
                }
                if (action === 'expand') {
                    list.expandItem(item);
                }
            });

            var onStartEvent = function(e)
            {
                var handle = $(e.target);
                if (!handle.hasClass(list.options.handleClass)) {
                    if (handle.closest('.' + list.options.noDragClass).length) {
                        return;
                    }
                    handle = handle.closest('.' + list.options.handleClass);
                }

                if (!handle.length || list.dragEl) {
                    return;
                }

                list.isTouch = /^touch/.test(e.type);
                if (list.isTouch && e.touches.length !== 1) {
                    return;
                }

                e.preventDefault();
                list.dragStart(e.touches ? e.touches[0] : e);
            };

            var onMoveEvent = function(e)
            {
                if (list.dragEl) {
                    e.preventDefault();
                    list.dragMove(e.touches ? e.touches[0] : e);
                }
            };

            var onEndEvent = function(e)
            {
                if (list.dragEl) {
                    e.preventDefault();
                    list.dragStop(e.touches ? e.touches[0] : e);
                }
            };

            if (hasTouch) {
                list.el[0].addEventListener('touchstart', onStartEvent, false);
                window.addEventListener('touchmove', onMoveEvent, false);
                window.addEventListener('touchend', onEndEvent, false);
                window.addEventListener('touchcancel', onEndEvent, false);
            }

            list.el.on('mousedown', onStartEvent);
            list.w.on('mousemove', onMoveEvent);
            list.w.on('mouseup', onEndEvent);

        },

        serialize: function()
        {
            var data,
                depth = 0,
                list  = this;
                step  = function(level, depth)
                {
                    var array = [ ],
                        items = level.children(list.options.itemNodeName);
                    items.each(function()
                    {
                        var li   = $(this),
                            item = $.extend({}, li.data()),
                            sub  = li.children(list.options.listNodeName);
                        if (sub.length) {
                            item.children = step(sub, depth + 1);
                        }
                        array.push(item);
                    });
                    return array;
                };
            data = step(list.el.find(list.options.listNodeName).first(), depth);
            return data;
        },

        serialise: function()
        {
            return this.serialize();
        },

        reset: function()
        {
            this.mouse = {
                offsetX   : 0,
                offsetY   : 0,
                startX    : 0,
                startY    : 0,
                lastX     : 0,
                lastY     : 0,
                nowX      : 0,
                nowY      : 0,
                distX     : 0,
                distY     : 0,
                dirAx     : 0,
                dirX      : 0,
                dirY      : 0,
                lastDirX  : 0,
                lastDirY  : 0,
                distAxX   : 0,
                distAxY   : 0
            };
            this.isTouch    = false;
            this.moving     = false;
            this.dragEl     = null;
            this.dragRootEl = null;
            this.dragDepth  = 0;
            this.hasNewRoot = false;
            this.pointEl    = null;
        },

        expandItem: function(li)
        {
            li.removeClass(this.options.collapsedClass);
            li.children('[data-action="expand"]').hide();
            li.children('[data-action="collapse"]').show();
            li.children(this.options.listNodeName).show();
        },

        collapseItem: function(li)
        {
            var lists = li.children(this.options.listNodeName);
            if (lists.length) {
                li.addClass(this.options.collapsedClass);
                li.children('[data-action="collapse"]').hide();
                li.children('[data-action="expand"]').show();
                li.children(this.options.listNodeName).hide();
            }
        },

        expandAll: function()
        {
            var list = this;
            list.el.find(list.options.itemNodeName).each(function() {
                list.expandItem($(this));
            });
        },

        collapseAll: function()
        {
            var list = this;
            list.el.find(list.options.itemNodeName).each(function() {
                list.collapseItem($(this));
            });
        },

        setParent: function(li)
        {
            if (li.children(this.options.listNodeName).length) {
                li.prepend($(this.options.expandBtnHTML));
                li.prepend($(this.options.collapseBtnHTML));
            }
            li.children('[data-action="expand"]').hide();
        },

        unsetParent: function(li)
        {
            li.removeClass(this.options.collapsedClass);
            li.children('[data-action]').remove();
            li.children(this.options.listNodeName).remove();
        },

        dragStart: function(e)
        {
            var mouse    = this.mouse,
                target   = $(e.target),
                dragItem = target.closest(this.options.itemNodeName);

            this.placeEl.css('height', dragItem.height());
            this.placeEl.css('width', dragItem.width());
            this.placeEl.css('display', dragItem.css("display"));

            mouse.offsetX = e.offsetX !== undefined ? e.offsetX : e.pageX - target.offset().left;
            mouse.offsetY = e.offsetY !== undefined ? e.offsetY : e.pageY - target.offset().top;
            mouse.startX = mouse.lastX = e.pageX;
            mouse.startY = mouse.lastY = e.pageY;

            this.dragRootEl = this.el;

            this.el_offset = this.el.offset();

            this.dragEl = $(document.createElement(this.options.listNodeName)).addClass(this.options.listClass + ' ' + this.options.dragClass);
            this.dragEl.css('width', dragItem.width());

            dragItem.after(this.placeEl);
            dragItem[0].parentNode.removeChild(dragItem[0]);
            dragItem.appendTo(this.dragEl);

            $(this.el).append(this.dragEl);
            this.dragEl.css({
                'left' : e.pageX - mouse.offsetX - this.el_offset.left,
                'top'  : e.pageY - mouse.offsetY - this.el_offset.top
            });
            // total depth of dragging item
            var i, depth,
                items = this.dragEl.find(this.options.itemNodeName);
            for (i = 0; i < items.length; i++) {
                depth = $(items[i]).parents(this.options.listNodeName).length;
                if (depth > this.dragDepth) {
                    this.dragDepth = depth;
                }
            }
        },

        dragStop: function(e)
        {
            var el = this.dragEl.children(this.options.itemNodeName).first();
            el[0].parentNode.removeChild(el[0]);
            this.placeEl.replaceWith(el);

            this.dragEl.remove();
            this.el.trigger('change');
            if (this.hasNewRoot) {
                this.dragRootEl.trigger('change');
            }
            this.reset();
        },

        dragMove: function(e)
        {
            var list, parent, prev, next, depth,
                opt   = this.options,
                mouse = this.mouse;

            this.dragEl.css({
                'left' : e.pageX - mouse.offsetX - this.el_offset.left,
                'top'  : e.pageY - mouse.offsetY - this.el_offset.top
            });

            // mouse position last events
            mouse.lastX = mouse.nowX;
            mouse.lastY = mouse.nowY;
            // mouse position this events
            mouse.nowX  = e.pageX;
            mouse.nowY  = e.pageY;
            // distance mouse moved between events
            mouse.distX = mouse.nowX - mouse.lastX;
            mouse.distY = mouse.nowY - mouse.lastY;
            // direction mouse was moving
            mouse.lastDirX = mouse.dirX;
            mouse.lastDirY = mouse.dirY;
            // direction mouse is now moving (on both axis)
            mouse.dirX = mouse.distX === 0 ? 0 : mouse.distX > 0 ? 1 : -1;
            mouse.dirY = mouse.distY === 0 ? 0 : mouse.distY > 0 ? 1 : -1;
            // axis mouse is now moving on
            var newAx   = Math.abs(mouse.distX) > Math.abs(mouse.distY) ? 1 : 0;

            // do nothing on first move
            if (!mouse.moving) {
                mouse.dirAx  = newAx;
                mouse.moving = true;
                return;
            }

            // calc distance moved on this axis (and direction)
            if (mouse.dirAx !== newAx) {
                mouse.distAxX = 0;
                mouse.distAxY = 0;
            } else {
                mouse.distAxX += Math.abs(mouse.distX);
                if (mouse.dirX !== 0 && mouse.dirX !== mouse.lastDirX) {
                    mouse.distAxX = 0;
                }
                mouse.distAxY += Math.abs(mouse.distY);
                if (mouse.dirY !== 0 && mouse.dirY !== mouse.lastDirY) {
                    mouse.distAxY = 0;
                }
            }
            mouse.dirAx = newAx;

            /**
             * move horizontal
             */
            if (mouse.dirAx && mouse.distAxX >= opt.threshold) {
                // reset move distance on x-axis for new phase
                mouse.distAxX = 0;
                prev = this.placeEl.prev(opt.itemNodeName);
                // increase horizontal level if previous sibling exists and is not collapsed
                if (mouse.distX > 0 && prev.length && !prev.hasClass(opt.collapsedClass)) {
                    // cannot increase level when item above is collapsed
                    list = prev.find(opt.listNodeName).last();
                    // check if depth limit has reached
                    depth = this.placeEl.parents(opt.listNodeName).length;
                    if (depth + this.dragDepth <= opt.maxDepth) {
                        // create new sub-level if one doesn't exist
                        if (!list.length) {
                            list = $('<' + opt.listNodeName + '/>').addClass(opt.listClass);
                            list.append(this.placeEl);
                            prev.append(list);
                            this.setParent(prev);
                        } else {
                            // else append to next level up
                            list = prev.children(opt.listNodeName).last();
                            list.append(this.placeEl);
                        }
                    }
                }
                // decrease horizontal level
                if (mouse.distX < 0) {
                    // we can't decrease a level if an item preceeds the current one
                    next = this.placeEl.next(opt.itemNodeName);
                    if (!next.length) {
                        parent = this.placeEl.parent();
                        this.placeEl.closest(opt.itemNodeName).after(this.placeEl);
                        if (!parent.children().length) {
                            this.unsetParent(parent.parent());
                        }
                    }
                }
            }

            var isEmpty = false;

            // find list item under cursor
            if (!hasPointerEvents) {
                this.dragEl[0].style.visibility = 'hidden';
            }
            this.pointEl = $(document.elementFromPoint(e.pageX - document.body.scrollLeft, e.pageY - (window.pageYOffset || document.documentElement.scrollTop)));
            if (!hasPointerEvents) {
                this.dragEl[0].style.visibility = 'visible';
            }
            if (this.pointEl.hasClass(opt.handleClass)) {
                this.pointEl = this.pointEl.closest("."+opt.itemClass);
            }
            if (this.pointEl.hasClass(opt.emptyClass)) {
                isEmpty = true;
            }
            else if (!this.pointEl.length || !this.pointEl.hasClass(opt.itemClass)) {
                return;
            }

            // find parent list of item under cursor
            var pointElRoot = this.pointEl.closest('.' + opt.rootClass),
                isNewRoot   = this.dragRootEl.data('nestable-id') !== pointElRoot.data('nestable-id');

            /**
             * move vertical
             */
            if (!mouse.dirAx || isNewRoot || isEmpty) {
                // check if groups match if dragging over new root
                if (isNewRoot && opt.group !== pointElRoot.data('nestable-group')) {
                    return;
                }
                // check depth limit
                depth = this.dragDepth - 1 + this.pointEl.parents(opt.listNodeName).length;
                if (depth > opt.maxDepth) {
                    return;
                }
                var before = e.pageY < (this.pointEl.offset().top + this.pointEl.height() / 2);
                    parent = this.placeEl.parent();
                // if empty create new list to replace empty placeholder
                if (isEmpty) {
                    list = $(document.createElement(opt.listNodeName)).addClass(opt.listClass);
                    list.append(this.placeEl);
                    this.pointEl.replaceWith(list);
                }
                else if (before) {
                    this.pointEl.before(this.placeEl);
                }
                else {
                    this.pointEl.after(this.placeEl);
                }
                if (!parent.children().length) {
                    this.unsetParent(parent.parent());
                }
                if (!this.dragRootEl.find(opt.itemNodeName).length) {
                    this.dragRootEl.append('<div class="' + opt.emptyClass + '"/>');
                }
                // parent root list has changed
                if (isNewRoot) {
                    this.dragRootEl = pointElRoot;
                    this.hasNewRoot = this.el[0] !== this.dragRootEl[0];
                }
            }
        }

    };

    $.fn.nestable = function(params)
    {
        var lists  = this,
            retval = this;

        lists.each(function()
        {
            var plugin = $(this).data("nestable");

            if (!plugin) {
                $(this).data("nestable", new Plugin(this, params));
                $(this).data("nestable-id", new Date().getTime());
            } else {
                if (typeof params === 'string' && typeof plugin[params] === 'function') {
                    retval = plugin[params]();
                }
            }
        });

        return retval || lists;
    };

})(window.jQuery || window.Zepto, window, document);


fieldval_ui_extend(ArrayField, Field);
function ArrayField(name, options) {
    var field = this;

    ArrayField.superConstructor.call(this, name, options);

    field.fields = [];

    field.add_field_buttons = [];

    field.element.addClass("fv_array_field");
    field.input_holder.append(
        field.fields_element = $("<div />").addClass("fv_nested_fields"),
        field.create_add_field_button()
    )

    field.input_holder.nestable({
        rootClass: 'fv_input_holder',
        itemClass: 'fv_field',
        handleClass: 'fv_field_move_handle',
        itemNodeName: 'div.fv_field',
        listNodeName: 'div.fv_nested_fields',
        collapseBtnHTML: '',
        expandBtnHTML: '',
        maxDepth: 1
    }).on('change', function(e){
        field.reorder();
    });
}

ArrayField.prototype.reorder = function(){
    var field = this;

    field.fields = [];

    var children = field.fields_element.children();
    for(var i = 0; i < children.length; i++){
        var child = $(children[i]);
        var child_field = child.data("field");
        field.fields.push(child_field);
    }
}

ArrayField.prototype.create_add_field_button = function(){
    var field = this;

    var add_field_button = $("<button />").addClass("fv_add_field_button").text("+").on(FVForm.button_event,function(event){
        event.preventDefault();
        field.new_field(field.fields.length);
    });

    field.add_field_buttons.push(add_field_button);

    return add_field_button;
}

ArrayField.prototype.new_field = function(index){
    var field = this;
    throw new Error("ArrayField.new_field must be overriden to create fields");
}

ArrayField.prototype.add_field = function(name, inner_field){
    var field = this;

    inner_field.in_array(function(){
        field.remove_field(inner_field);
    });
    inner_field.element.appendTo(field.fields_element);
    field.fields.push(inner_field);

    field.input_holder.nestable('init');
}

ArrayField.prototype.remove_field = function(inner_field){
    var field = this;

    for(var i = 0; i < field.fields.length; i++){
        if(field.fields[i]===inner_field){
            field.fields.splice(i,1);
        }
    }
}

ArrayField.prototype.view_mode = function(){
    var field = this;

    for(var i in field.fields){
        field.fields[i].view_mode();
    }

    for(var i = 0; i < field.add_field_buttons.length; i++){
        var add_field_button = field.add_field_buttons[i];
        add_field_button.hide()
    }
}

ArrayField.prototype.edit_mode = function(){
    var field = this;

    for(var i in field.fields){
        field.fields[i].edit_mode();
    }

    for(var i = 0; i < field.add_field_buttons.length; i++){
        var add_field_button = field.add_field_buttons[i];
        add_field_button.show()
    }
}

ArrayField.prototype.error = function(error){
    var field = this;

    ArrayField.superClass.error.call(this,error);
}

ArrayField.prototype.fields_error = function(error){
    var field = this;

    if(error){
        var invalid_fields = error.invalid || {};
        var missing_fields = error.missing || {};
        var unrecognized_fields = error.unrecognized || {};
        
        for(var i = 0; i < field.fields.length; i++){
            var inner_field = field.fields[i];

            var field_error = invalid_fields[i] || missing_fields[i] || unrecognized_fields[i] || null;
            inner_field.error(field_error);
        }

    } else {
        for(var i in field.fields){
            var inner_field = field.fields[i];
            inner_field.error(null);
        }
    }
}


ArrayField.prototype.clear_errors = function(){
	var field = this;


}

ArrayField.prototype.error = function(error) {
    var field = this;

    field.error_message.empty();

    if(error){

        if(error.error===undefined){
            console.error("No error provided");
            return;
        }

        if(error.error===0){
            field.fields_error(error);
            field.hide_error();
        } else {
            if(error.error===4){
                var error_list = $("<ul />");
                for(var i = 0; i < error.errors.length; i++){
                    var sub_error = error.errors[i];
                    if(sub_error.error===0){
                        field.fields_error(sub_error);
                    } else {
                        error_list.append(
                            $("<li />").text(sub_error.error_message)
                        )
                    }
                }
                field.error_message.append(
                    error_list
                );
            } else {
                field.error_message.append(
                    $("<span />").text(error.error_message)
                )
            }
            field.show_error();
        }
    } else {
        //Clear error
        field.fields_error(null);
        field.hide_error();
    }
}

ArrayField.prototype.val = function(set_val) {
    var field = this;

    if (arguments.length===0) {
    	var compiled = [];
    	for(var i=0; i<field.fields.length; i++){
    		var inner_field = field.fields[i];
            var value = inner_field.val();
    		compiled.push(value);
    	}
        return compiled;
    } else {
        if(set_val){
            for(var i=0; i<set_val.length; i++){
        		var inner_field = field.fields[i];
                if(!inner_field){
                    inner_field = field.new_field(i);
                }
                inner_field.val(set_val[i]);
        	}
        }
        return field;
    }
}

if (typeof module != 'undefined') {
    module.exports = {
    	fieldval: FieldVal,
    	basicval: BasicVal,
    	dateval: DateVal,
    	rules: ValidationRule
    };
}