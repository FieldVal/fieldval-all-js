var logger;
if((typeof require) === 'function'){
    logger = require('tracer').console();
}

FieldVal = function(validating) {
    var fv = this;

    fv.validating = validating;
    fv.missing_keys = {};
    fv.missing_count = 0;
    fv.invalid_keys = {};
    fv.invalid_count = 0;
    fv.unrecognized_keys = {};
    fv.unrecognized_count = 0;
    fv.recognized_keys = {};

    //Top level errors - added using .error() 
    fv.errors = [];
}

FieldVal.INCORRECT_TYPE_ERROR = function(expected_type, type){
    return {
        error_message: "Incorrect field type. Expected " + expected_type + ".",
        error: FieldVal.INCORRECT_FIELD_TYPE,
        expected: expected_type,
        received: type
    };
}

FieldVal.MISSING_ERROR = function(){
    return {
        error_message: "Field missing.",
        error: FieldVal.FIELD_MISSING
    };
}

FieldVal.REQUIRED_ERROR = "required";
FieldVal.NOT_REQUIRED_BUT_MISSING = "notrequired";

FieldVal.ONE_OR_MORE_ERRORS = 0;
FieldVal.FIELD_MISSING = 1;
FieldVal.INCORRECT_FIELD_TYPE = 2;
FieldVal.FIELD_UNRECOGNIZED = 3;
FieldVal.MULTIPLE_ERRORS = 4;

FieldVal.get_value_and_type = function(value, desired_type, flags) {
    if(!flags){
        flags = {};
    }
    var parse = (typeof flags.parse) != 'undefined' ? flags.parse : false;

    if(typeof value !== 'string' || parse){
        if (desired_type == "integer") {
            var parsed = parseInt(value);
            if (!isNaN(parsed) && ("" + parsed).length == ("" + value).length) {
                value = parsed;
                desired_type = parsed;
                desired_type = "number";
            }
        } else if (desired_type == "float") {
            var parsed = parseFloat(value);
            if (!isNaN(parsed)) {
                value = parsed;
                desired_type = "number";
            }
        }
    }

    var type = typeof value;

    if (type == "object") {
        //typeof on Array returns "object", do check for an array
        if (Object.prototype.toString.call(value) === '[object Array]') {
            type = "array";
        }
    }

    return {
        type: type,
        desired_type: desired_type,
        value: value
    };
}

FieldVal.use_checks = function(value, checks, existing_validator, field_name, emit){
    var had_error = false;
    var stop = false;

    var validator;
    if(!existing_validator){
        validator = new FieldVal();
    }

    var return_missing = false;//Used to escape from check list if a check returns a FieldVal.REQUIRED_ERROR error.

    var use_check = function(this_check){

        var this_check_function;
        var stop_on_error = true;//Default to true
        var flags = {};
        if((typeof this_check) === 'object'){
            if(Object.prototype.toString.call(this_check)==='[object Array]'){
                for(var i = 0; i < this_check.length; i++){
                    use_check(this_check[i]);
                    if(stop){
                        break;
                    }
                }
                return;
            } else if(this_check.length==0){
                //Empty array
                return;
            } else {
                flags = this_check;
                this_check_function = flags.check;
                if(flags!=null && (flags.stop_on_error!==undefined)){
                    stop_on_error = flags.stop_on_error;
                }
            }
        } else {
            this_check_function = this_check;
            stop_on_error = true;//defaults to true
        }

        var check = this_check_function(value, function(new_value){
            value = new_value;
        });
        if (check != null){
            if(check===FieldVal.REQUIRED_ERROR){
                if(field_name){
                    if(existing_validator){
                        existing_validator.missing(field_name, flags);
                    } else {
                        return check;
                    }
                } else {
                    if(existing_validator){
                        existing_validator.error(
                            FieldVal.create_error(FieldVal.MISSING_ERROR, flags)
                        )
                    } else {
                        return_missing = true;
                        return;
                    }
                }
            } else if(check===FieldVal.NOT_REQUIRED_BUT_MISSING){
                //Don't process proceeding checks, but don't throw an error
            } else {
                if(existing_validator){
                    if(field_name){
                        existing_validator.invalid(field_name, check);
                    } else {
                        existing_validator.error(check);
                    }
                } else {
                    validator.error(check);
                }
            }
            had_error = true;
            if(stop_on_error){
                stop = true;
            }
        }
    }

    for (var i = 0; i < checks.length; i++) {
        var this_check = checks[i];
        use_check(this_check);
        if(return_missing){
            return FieldVal.REQUIRED_ERROR;
        }
        if(stop){
            break;
        }
    }

    if(had_error){
        if(emit){
            emit(undefined);
        }
    } else {
        if(emit){
            emit(value);
        }
    }

    if(!existing_validator){
        return validator.end();
    }
}

FieldVal.required = function(required, flags){//required defaults to true
    var check = function(value) {
        if (value==null) {
            if(required || required===undefined){
                return FieldVal.REQUIRED_ERROR;
            } else {
                return FieldVal.NOT_REQUIRED_BUT_MISSING;
            }
        }
    }
    if(flags!==undefined){
        flags.check = check;
        return flags
    }
    return check;
};


FieldVal.type = function(desired_type, flags) {

    var required = (flags.required !== undefined) ? flags.required : true;

    var check = function(value, emit) {

        var required_error = FieldVal.required(required)(value); 
        if(required_error) return required_error;

        var value_and_type = FieldVal.get_value_and_type(value, desired_type, flags);

        var inner_desired_type = value_and_type.desired_type;
        var type = value_and_type.type;
        var value = value_and_type.value;

        if (type !== inner_desired_type) {
            return FieldVal.create_error(FieldVal.INCORRECT_TYPE_ERROR, flags, inner_desired_type, type);
        }
        if(emit){
            emit(value);
        }
    }
    if(flags!==undefined){
        flags.check = check;
        return flags
    }
    return check;
}

FieldVal.prototype.default = function(default_value){
    var fv = this;

    return {
        get: function(field_name){
            var get_result = fv.get.apply(fv,arguments);
            if((typeof get_result) !== 'undefined'){
                return get_result;
            }
            //No value. Return the default
            return default_value;
        }
    }
};

FieldVal.prototype.get = function(field_name) {//Additional arguments are checks
    var fv = this;

    var value = fv.validating[field_name];

    fv.recognized_keys[field_name] = true;

    if (arguments.length > 1) {
        //Additional checks

        var checks = Array.prototype.slice.call(arguments,1);
        FieldVal.use_checks(value, checks, fv, field_name, function(new_value){
            value = new_value;
        });
    }

    return value;
},

//Top level error - something that cannot be assigned to a particular key
FieldVal.prototype.error = function(error){
    var fv = this;

    fv.errors.push(error);

    return fv;
},

FieldVal.prototype.invalid = function(field_name, error) {
    var fv = this;

    var existing = fv.invalid_keys[field_name];
    if (existing != null) {
        //Add to an existing error
        if (existing.errors != null) {
            existing.errors.push(error);
        } else {
            fv.invalid_keys[field_name] = {
                error: FieldVal.MULTIPLE_ERRORS,
                error_message: "Multiple errors.",
                errors: [existing, error]
            }
        }
    } else {
        fv.invalid_keys[field_name] = error;
        fv.invalid_count++;
    }
    return fv;
},

FieldVal.prototype.missing = function(field_name, flags) {
    var fv = this;

    fv.missing_keys[field_name] = FieldVal.create_error(FieldVal.MISSING_ERROR, flags);
    fv.missing_count++;
    return fv;
},

FieldVal.prototype.unrecognized = function(field_name) {
    var fv = this;

    fv.unrecognized_keys[field_name] = {
        error_message: "Unrecognized field.",
        error: FieldVal.FIELD_UNRECOGNIZED
    };
    fv.unrecognized_count++;
    return fv;
},

FieldVal.prototype.recognized = function(field_name){
    var fv = this;

    fv.recognized_keys[field_name] = true;

    return fv;
},

//Exists to allow processing of remaining keys after known keys are checked
FieldVal.prototype.get_unrecognized = function(){
    var fv = this;

    var unrecognized = [];
    for (var key in fv.validating) {
        if (fv.recognized_keys[key] != true) {
            unrecognized.push(key);
        }
    }
    return unrecognized;
},

FieldVal.prototype.end = function() {
    var fv = this;

    var returning = {};

    var has_error = false;

    var returning_unrecognized = {};
    var returning_unrecognized_count = 0;

    //Iterate through manually unrecognized keys
    for(var key in fv.unrecognized){
        returning_unrecognized[key] = fv.unrecognized[key];
        returning_unrecognized_count++;
    }

    var auto_unrecognized = fv.get_unrecognized();
    for(var i = 0; i < auto_unrecognized.length; i++){
        var key = auto_unrecognized[i];
        if(!returning_unrecognized[key]){
            returning_unrecognized[key] = {
                error_message: "Unrecognized field.",
                error: FieldVal.FIELD_UNRECOGNIZED
            }
            returning_unrecognized_count++;
        }
    }

    if(fv.missing_count !== 0) {
        returning.missing = fv.missing_keys;
        has_error = true;
    }
    if(fv.invalid_count !== 0) {
        returning.invalid = fv.invalid_keys;
        has_error = true;
    }
    if(returning_unrecognized_count !== 0) {
        returning.unrecognized = returning_unrecognized;
        has_error = true;
    }

    if (has_error) {
        returning.error_message = "One or more errors.";
        returning.error = FieldVal.ONE_OR_MORE_ERRORS;

        if(fv.errors.length===0){
            return returning;
        } else {
            fv.errors.push(returning);
        }
    }

    if(fv.errors.length!==0){
        //Have top level errors
        
        if(fv.errors.length===1){
            //Only 1 error, just return it
            return fv.errors[0];
        } else {
            //Return a "multiple errors" error
            return {
                error: FieldVal.MULTIPLE_ERRORS,
                error_message: "Multiple errors.",
                errors: fv.errors
            }
        }
    }

    return null;
}

FieldVal.create_error = function(default_error, flags){
    if(!flags){
        return default_error.apply(null, Array.prototype.slice.call(arguments,2));
    }
    if(default_error===FieldVal.MISSING_ERROR){
        if((typeof flags.missing_error) === 'function'){
            return flags.missing_error.apply(null, Array.prototype.slice.call(arguments,2));
        } else if((typeof flags.missing_error) === 'object'){
            return flags.missing_error;
        } else if((typeof flags.missing_error) === 'string'){
            return {
                error_message: flags.missing_error
            }
        }
    } else {
        if((typeof flags.error) === 'function'){
            return flags.error.apply(null, Array.prototype.slice.call(arguments,2));
        } else if((typeof flags.error) === 'object'){
            return flags.error;
        } else if((typeof flags.error) === 'string'){
            return {
                error_message: flags.error
            }
        }
    }

    return default_error.apply(null, Array.prototype.slice.call(arguments,2));
}

FieldVal.Error = function(number, message, data) {
    if (((typeof number)==='object') && Object.prototype.toString.call(number) === '[object Array]') {
        var array = number;
        number = array[0];
        message = array[1];
        data = array[2];
    }
    var obj = {
        error: number
    };
    if (message != null) {
        obj.error_message = message;
    }
    if (data != null) {
        obj.data = data;
    }
    return obj;
}

if (typeof module != 'undefined') {
    module.exports = FieldVal;
}
var logger;
if((typeof require) === 'function'){
    logger = require('tracer').console();
}

var _validator_ref;

if((typeof require) === 'function'){
    _validator_ref = require("fieldval");
} else {
    _validator_ref = FieldVal;
}

var BasicVal = {
    errors: {
        too_short: function(min_len) {
            return {
                error: 100,
                error_message: "Length is less than " + min_len
            }
        },
        too_long: function(max_len) {
            return {
                error: 101,
                error_message: "Length is greater than " + max_len
            }
        },
        too_small: function(min_val) {
            return {
                error: 102,
                error_message: "Value is less than " + min_val
            }
        },
        too_large: function(max_val) {
            return {
                error: 103,
                error_message: "Value is greater than " + max_val
            }
        },
        not_in_list: function() {
            return {
                error: 104,
                error_message: "Value is not a valid choice"
            }
        },
        cannot_be_empty: function() {
            return {
                error: 105,
                error_message: "Value cannot be empty."
            }
        },
        no_prefix: function(prefix) {
            return {
                error: 106,
                error_message: "Value does not have prefix: " + prefix
            }
        },
        invalid_email: function() {
            return {
                error: 107,
                error_message: "Invalid email address format."
            }
        },
        invalid_url: function() {
            return {
                error: 108,
                error_message: "Invalid url format."
            }
        },
        incorrect_length: function(len){
            return {
                error: 109,
                error_message: "Length is not equal to " + len
            }
        },
        no_suffix: function(suffix) {
            return {
                error: 110,
                error_message: "Value does not have suffix: " + suffix
            }
        }
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
        return _validator_ref.type("integer",BasicVal.merge_required_and_flags(required, flags));
    },
    number: function(required, flags){
        return _validator_ref.type("number",BasicVal.merge_required_and_flags(required, flags));
    },
    array: function(required, flags){
        return _validator_ref.type("array",BasicVal.merge_required_and_flags(required, flags));
    },
    object: function(required, flags){
        return _validator_ref.type("object",BasicVal.merge_required_and_flags(required, flags));
    },
    float: function(required, flags){
        return _validator_ref.type("float",BasicVal.merge_required_and_flags(required, flags));
    },
    boolean: function(required, flags){
        return _validator_ref.type("boolean",BasicVal.merge_required_and_flags(required, flags));
    },
    string: function(required, flags){
        flags = BasicVal.merge_required_and_flags(required, flags);
        var check = function(value, emit) {

            var core_check = _validator_ref.type("string",flags);
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
                    return _validator_ref.REQUIRED_ERROR;
                } else {
                    return _validator_ref.NOT_REQUIRED_BUT_MISSING;
                }
            }
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
    },
    length: function(len, flags) {
        var check = function(value) {
            if (value.length!==len) {
                return FieldVal.create_error(BasicVal.errors.incorrect_length, flags, len)
            }
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
    },
    min_length: function(min_len, flags) {
        var check = function(value) {
            if (value.length < min_len) {
                return FieldVal.create_error(BasicVal.errors.too_short, flags, min_len)
            }
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
    },
    max_length: function(max_len, flags) {
        var check = function(value) {
            if (value.length > max_len) {
                return FieldVal.create_error(BasicVal.errors.too_long, flags, max_len);
            }
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
    },
    minimum: function(min_val, flags) {
        var check = function(value) {
            if (value < min_val) {
                return FieldVal.create_error(BasicVal.errors.too_small, flags, min_val);
            }
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
    },
    maximum: function(max_val, flags) {
        var check = function(value) {
            if (value > max_val) {
                return FieldVal.create_error(BasicVal.errors.too_large, flags, max_val);
            }
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
    },
    range: function(min_val, max_val, flags) {
        //Effectively combines minimum and maximum
        var check = function(value){
            if (value < min_val) {
                return FieldVal.create_error(BasicVal.errors.too_small, flags, min_val);
            } else if (value > max_val) {
                return FieldVal.create_error(BasicVal.errors.too_large, flags, max_val);
            }
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
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
            for(var i in array){
                valid_values.push(i);
            }
        }
        var check = function(value) {
            if (valid_values.indexOf(value) === -1) {
                return FieldVal.create_error(BasicVal.errors.not_in_list, flags);
            }
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
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
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
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
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
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
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
    },
    each: function(on_each, flags) {
        var check = function(array, stop) {
            var validator = new _validator_ref(null);
            for (var i = 0; i < array.length; i++) {
                var value = array[i];

                var res = on_each(value,i);
                if (res != null) {
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
            return flags
        }
        return check;
    },
    email: function(flags){
        var check = function(value) {
            var re = BasicVal.email_regex;
            if(!re.test(value)){
                return FieldVal.create_error(BasicVal.errors.invalid_email, flags);
            } 
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
    },
    url: function(flags){
        var check = function(value) {
            var re = BasicVal.url_regex;
            if(!re.test(value)){
                return FieldVal.create_error(BasicVal.errors.invalid_url, flags);
            } 
        }
        if(flags){
            flags.check = check;
            return flags
        }
        return check;
    }
}

BasicVal.email_regex = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
BasicVal.url_regex = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;

if (typeof module != 'undefined') {
    module.exports = BasicVal;
}
if((typeof require) === 'function'){
    FieldVal = require('fieldval')
    BasicVal = require('fieldval-basicval')
}

function fieldval_rules_extend(sub, sup) {
    function emptyclass() {}
    emptyclass.prototype = sup.prototype;
    sub.prototype = new emptyclass();
    sub.prototype.constructor = sub;
    sub.superConstructor = sup;
    sub.superClass = sup.prototype;
}
fieldval_rules_extend(TextRuleField, RuleField);

function TextRuleField(json, validator) {
    var field = this;

    TextRuleField.superConstructor.call(this, json, validator);
}

TextRuleField.prototype.create_ui = function(parent){
    var field = this;

    if(TextField){
        var ui_field = new TextField(field.display_name || field.name, field.json);
        parent.add_field(field.name, ui_field);
        return ui_field;
    }
}

TextRuleField.prototype.init = function() {
    var field = this;

    field.min_length = field.validator.get("min_length", BasicVal.integer(false));
    field.max_length = field.validator.get("max_length", BasicVal.integer(false));

    field.phrase = field.validator.get("phrase", BasicVal.string(false));
    field.equal_to = field.validator.get("equal_to", BasicVal.string(false));
    field.ci_equal_to = field.validator.get("ci_equal_to", BasicVal.string(false));
    field.prefix = field.validator.get("prefix", BasicVal.string(false));
    field.ci_prefix = field.validator.get("ci_prefix", BasicVal.string(false));
    field.query = field.validator.get("query", BasicVal.string(false));
    
    return field.validator.end();
}

TextRuleField.prototype.create_checks = function(){
    var field = this;

    field.checks.push(BasicVal.string(field.required));

    if(field.min_length){
        field.checks.push(BasicVal.min_length(field.min_length,{stop_on_error:false}));
    }
    if(field.max_length){
        field.checks.push(BasicVal.max_length(field.max_length,{stop_on_error:false}));
    }
}
fieldval_rules_extend(NumberRuleField, RuleField);

function NumberRuleField(json, validator) {
    var field = this;

    NumberRuleField.superConstructor.call(this, json, validator);
}

NumberRuleField.prototype.create_ui = function(parent){
    var field = this;

    if(TextField){
        var ui_field = new TextField(field.display_name || field.name, field.json);
        parent.add_field(field.name, ui_field);
        return ui_field;
    }
}

NumberRuleField.prototype.init = function() {
    var field = this;

    field.minimum = field.validator.get("minimum", BasicVal.number(false));
    if (field.minimum != null) {

    }

    field.maximum = field.validator.get("maximum", BasicVal.number(false));
    if (field.maximum != null) {

    }

    field.integer = field.validator.get("integer", BasicVal.boolean(false));

    return field.validator.end();
}

NumberRuleField.prototype.create_checks = function(){
    var field = this;
    
    field.checks.push(BasicVal.number(field.required));

    if(field.minimum){
        field.checks.push(BasicVal.minimum(field.minimum,{stop_on_error:false}));
    }
    if(field.maximum){
        field.checks.push(BasicVal.maximum(field.maximum,{stop_on_error:false}));
    }
    if(field.integer){
        field.checks.push(BasicVal.integer(false,{stop_on_error:false}));
    }
}
fieldval_rules_extend(ObjectRuleField, RuleField);

function ObjectRuleField(json, validator) {
    var field = this;

    ObjectRuleField.superConstructor.call(this, json, validator);
}

ObjectRuleField.prototype.create_ui = function(parent,form){
    var field = this;

    if(ObjectField){
        var object_field;
        if(form){
            object_field = form;
        } else {
            object_field = new ObjectField(field.display_name || field.name, field.json);
        }

        for(var i in field.fields){
            var inner_field = field.fields[i];
            inner_field.create_ui(object_field);
        }

        if(!form){
            parent.add_field(field.name, object_field);
        }

        return object_field;
    }
}

ObjectRuleField.prototype.init = function() {
    var field = this;

    field.fields = {};

    var fields_json = field.validator.get("fields", BasicVal.object(false));
    if (fields_json != null) {
        var fields_validator = new FieldVal(null);

        //TODO prevent duplicate name keys

        for (var name in fields_json) {
            var field_json = fields_json[name];

            if(!field_json.name){
                field_json.name = name;
            }

            var field_creation = RuleField.create_field(field_json);
            var err = field_creation[0];
            var nested_field = field_creation[1];

            if(err!=null){
                fields_validator.invalid(name,err);
            }

            field.fields[name] = nested_field;
        }

        var fields_error = fields_validator.end();
        if(fields_error!=null){
            field.validator.invalid("fields",fields_error);
        }
    }

    return field.validator.end();
}

ObjectRuleField.prototype.create_checks = function(validator){
    var field = this;

    field.checks.push(BasicVal.object(field.required));

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
fieldval_rules_extend(ChoiceRuleField, RuleField);

function ChoiceRuleField(json, validator) {
    var field = this;

    ChoiceRuleField.superConstructor.call(this, json, validator);
}

ChoiceRuleField.prototype.create_ui = function(parent){
    var field = this;

    if(ChoiceField){
        var ui_field = new ChoiceField(field.display_name || field.name, field.choices, field.json);
        parent.add_field(field.name, ui_field);
        return ui_field;
    }
}

ChoiceRuleField.prototype.init = function() {
    var field = this;

    field.choices = field.validator.get("choices", BasicVal.array(true));

    return field.validator.end();
}

ChoiceRuleField.prototype.create_checks = function(){
    var field = this;

    field.checks.push(FieldVal.required(true))
    if(field.choices){
        field.checks.push(BasicVal.one_of(field.choices,{stop_on_error:false}));
    }
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
    field.required = field.validator.default(true).get("required", BasicVal.boolean(false))

    if (json != null) {
        var exists = field.validator.get("exists", BasicVal.boolean(false));
        if (exists != null) {
            existsFilter = exists ? 1 : 2;
        }
    }
}

RuleField.types = {
    text: TextRuleField,
    string: TextRuleField,
    number: NumberRuleField,
    object: ObjectRuleField,
    choice: ChoiceRuleField
};

RuleField.create_field = function(json) {
    var field = null;

    var validator = new FieldVal(json);

    var type = validator.get("type", BasicVal.string(true), BasicVal.one_of(RuleField.types));

    if(type){
        var field_class = RuleField.types[type];
        field = new field_class(json, validator)
    } else {
        //Create a generic field to create the correct errors for the "RuleField" fields
        return [validator.end(), null];
    }

    var init_res = field.init();
    if (init_res != null) {
        return [init_res, null];
    }

    field.create_checks();

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

function ValidationRule() {
    var vr = this;
}

//Performs validation required for saving
ValidationRule.prototype.init = function(json) {
    var vr = this;

    var field_res = RuleField.create_field(json);

    //There was an error creating the field
    if(field_res[0]){
        return field_res[0];
    }

    //Keep the created field
    vr.field = field_res[1];
}

ValidationRule.prototype.create_form = function(){
    var vr = this;

    if(Form){
        var form = new Form();
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

	form.element = $("<form />").addClass("fieldval_ui_form").append(
		form.error_message = $("<div />").addClass("error_message").hide()
	).on("submit",function(event){
        event.preventDefault();
        form.submit();
	});

	form.fields = fields || {};

	//Used because ObjectField uses some FVForm.prototype functions
	form.fields_element = form.element;

	form.submit_callbacks = [];
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

    field.container.appendTo(form.fields_element);
    form.fields[name] = field;

    return form;
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
			if(field.show_on_form_flag){
				output[i] = field.val();
			}
		}
		return output;
    } else {
    	for(var i in form.fields){
    		var field = form.fields[i];
    		field.val(set_val[i]);
    	}
        return form;
    }
}
function Field(name) {
    var field = this;

    field.name = name;

    field.show_on_form_flag = true;

    field.on_change_callbacks = [];

    field.container = $("<div />").addClass("field_container");
    field.element = $("<div />").addClass("field");
    field.title = $("<div />").addClass("field_title").text(field.name)
    field.input_holder = $("<div />").addClass("input_holder")
    field.error_message = $("<div />").addClass("error_message").hide()

    field.layout();
}

Field.prototype.view_mode = function(){
    var field = this;    
}

Field.prototype.edit_mode = function(){
    var field = this;    
}

Field.prototype.change_name = function(name) {
    var field = this;
    field.name = name;
    return field;
}

Field.prototype.layout = function(){
    var field = this;

    field.container.append(
        field.title,
        field.element.append(
            field.input_holder,
            field.error_message
        )
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
        if(field.container){
            field.container.addClass("field_error");
        }
        field.show_error();
    } else {
        field.hide_error();
        if(field.container){
            field.container.removeClass("field_error");
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
        field.input_type = options.input_type || "text";
    } else {
        options = {};
    }

    field.options = options;

    TextField.superConstructor.call(this, name);

    field.element.addClass("text_field");

    if(field.input_type==='textarea'){
        field.input = $("<textarea />")
    } else if(field.input_type==='text' || field.input_type==='number') {
        field.input = $("<input type='text' />")
    } else {
        field.input = $("<input type='"+field.input_type+"' />")
    }
    
    field.input.addClass("text_input")
    .attr("placeholder", name)
    .on("keyup",function(){
        field.did_change()
    })
    .appendTo(field.input_holder);
}

TextField.prototype.view_mode = function(){
    var field = this;

    field.input.prop({
        "readonly": "readonly",
        "disabled": "disabled"
    })

    field.element.addClass("view_mode")
}

TextField.prototype.edit_mode = function(){
    var field = this;

    field.input.prop({
        "readonly": null,
        "disabled": null
    })

    field.element.removeClass("view_mode")
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

TextField.numeric_regex = /^\d+(?:\.\d+)$/;

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

function DisplayField(name, input_type) {
    var field = this;

    DisplayField.superConstructor.call(this, name);

    field.element.addClass("display_field");

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

function ChoiceField(name, properties) {
    var field = this;

    ChoiceField.superConstructor.call(this, name, properties);

    field.properties = properties;

    field.choices = field.properties.choices || [];
    field.allow_empty = field.properties.allow_empty || false;

    field.element.addClass("choice_field");

    field.select = $("<select/>")
    .addClass("choice_input")
    .on("change",function(){
        field.did_change()
    })
    .appendTo(field.input_holder);

    field.choice_values = [];

    if(field.allow_empty){
        var option = $("<option />").attr("value",null).text("")
        field.select.append(option);
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

        var option = $("<option />").attr("value",choice_value).text(choice_text)
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
        return field.select.find(":selected").attr("value")
    } else {
        if(set_val!=null){
            field.select.val(set_val);
        } else {
            field.select.val(field.choice_values[0]);
        }
        return field;
    }
}
fieldval_ui_extend(DateField, Field);

function DateField(name, format) {//format is currently unused
    var field = this;

    field.format = format;

    DateField.superConstructor.call(this, name);

    field.element.addClass("date_field");

    field.input_holder.append(
        field.day_input = $("<input type='number' />")
        .addClass("day_input date_input")
        .attr("placeholder", "DD")
        .on("keyup",function(){
            field.did_change()
        }),

        field.month_input = $("<input type='number' />")
        .addClass("month_input date_input")
        .attr("placeholder", "MM")
        .on("keyup",function(){
            field.did_change()
        }),
        
        field.year_input = $("<input type='number' />")
        .addClass("year_input date_input")
        .attr("placeholder", "YYYY")
        .on("keyup",function(){
            field.did_change()
        })
    )

}

DateField.prototype.icon = function(params) {
    var field = this;

    // var css_props = {
    //     'background-image': "url(" + params.background + ")",
    //     'background-position': params.position,
    //     'background-repeat': "no-repeat",
    //     'padding-left': params.width + "px"
    // }

    // field.input.css(css_props);
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
    field.day_input.attr("disabled", "disabled");
    field.month_input.attr("disabled", "disabled");
    field.year_input.attr("disabled", "disabled");
    return field;
}

DateField.prototype.enable = function() {
    var field = this;
    field.day_input.attr("disabled", null);
    field.month_input.attr("disabled", null);
    field.year_input.attr("disabled", null);
    return field;
}

DateField.prototype.focus = function() {
    var field = this;
    field.day_input.focus();
    return field;
}

DateField.prototype.blur = function() {
    var field = this;
    field.day_input.blur();
    field.month_input.blur();
    field.year_input.blur();
    return field;
}

DateField.prototype.val = function(set_val) {
    var field = this;

    if (arguments.length===0) {

        var day = field.day_input.val();
        var month = field.month_input.val();
        var year = field.year_input.val();

        //TODO Use field.format here
        var date_string = year+"-"+month+"-"+day;

        return date_string;
    } else {

        if(set_val!=null){

            //TODO Use field.format here
            var day = set_val.substring(8,10);
            var month = set_val.substring(5,7);
            var year = set_val.substring(0,4);

            field.day_input.val(day);
            field.month_input.val(month);
            field.year_input.val(year);
        }

        return field;
    }
}
fieldval_ui_extend(BooleanField, Field);

function BooleanField(name) {
    var field = this;

    BooleanField.superConstructor.call(this, name);

    field.element.addClass("choice_field");

    field.input = $("<input type='checkbox' />")
    .addClass("boolean_input")
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
       	field.input.prop('checked', set_val);
        return field;
    }
}
fieldval_ui_extend(ObjectField, Field);

function ObjectField(name) {
    var field = this;

    ObjectField.superConstructor.call(this, name);

    field.element.addClass("object_field");

    field.fields_element = field.input_holder;

    field.fields = {};
}

ObjectField.prototype.add_field = function(name, field){
	Form.prototype.add_field.call(this,name,field);
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
}

ObjectField.prototype.edit_mode = function(){
    var field = this;

    for(var i in field.fields){
        field.fields[i].edit_mode();
    }
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
    return field;
}

ObjectField.prototype.error = function(error){
    var field = this;

    ObjectField.superClass.error.call(this,error);

    Form.prototype.error.call(this,error);
}

ObjectField.prototype.fields_error = function(error){
    var field = this;

    Form.prototype.fields_error.call(this,error);
}


ObjectField.prototype.clear_errors = function(){
	var field = this;

	Form.prototype.clear_errors.call(this);
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
    		inner_field.val(set_val[i]);
    	}
        return field;
    }
}

if (typeof module != 'undefined') {
    module.exports = {
    	fieldval: FieldVal,
    	bval: BasicVal,
    	rule: ValidationRule
    };
}