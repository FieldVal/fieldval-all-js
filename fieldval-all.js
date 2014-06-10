var logger;
if((typeof require) === 'function'){
    logger = require('tracer').console();
}

Validator = function(validating) {
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

Validator.REQUIRED_ERROR = "required";
Validator.NOT_REQUIRED_BUT_MISSING = "notrequired";

Validator.ONE_OR_MORE_ERRORS = 0;
Validator.FIELD_MISSING = 1;
Validator.INCORRECT_FIELD_TYPE = 2;
Validator.FIELD_UNRECOGNIZED = 3;
Validator.MULTIPLE_ERRORS = 4;

Validator.get_value_and_type = function(value, desired_type) {
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

Validator.use_operators = function(value, operators, validator, field_name){
    var had_error = false;
    var stop = false;

    var use_operator = function(this_operator){

        var this_operator_function;
        if((typeof this_operator) === 'object'){
            if(Object.prototype.toString.call(this_operator)==='[object Array]'){
                for(var i = 0; i < this_operator.length; i++){
                    use_operator(this_operator[i]);
                    if(stop){
                        break;
                    }
                }
                return;
            } else if(this_operator.length==0){
                //Empty array
                return;
            } else {
                flags = this_operator;
                this_operator_function = flags.operator;
                if(flags!=null && flags.stop_if_error){
                    stop_if_error = true;
                }
            }
        } else {
            this_operator_function = this_operator;
            stop_if_error = true;//defaults to true
        }

        var check = this_operator_function(value, function(new_value){
            value = new_value;
        });
        if (check != null){
            if(validator){
                if(check===Validator.REQUIRED_ERROR){
                    if(field_name){
                        validator.missing(field_name);   
                    } else {
                        validator.error({
                            error_message: "Field missing.",
                            error: Validator.FIELD_MISSING
                        })
                    }
                } else if(check===Validator.NOT_REQUIRED_BUT_MISSING){
                    //Don't process proceeding operators, but don't throw an error
                } else {
                    if(field_name){
                        validator.invalid(field_name, check);
                    } else {
                        validator.error(check);
                    }
                }
            }
            had_error = true;
            if(stop_if_error){
                stop = true;
            }
        }
    }

    for (var i = 0; i < operators.length; i++) {
        var this_operator = operators[i];
        use_operator(this_operator);
        if(stop){
            break;
        }
    }
    if (had_error) {
        return undefined;
    }

    return value;
}

Validator.required = function(required, flags){//required defaults to true
    var operator = function(value) {
        if (value==null) {
            if(required || required===undefined){
                return Validator.REQUIRED_ERROR;
            } else {
                return Validator.NOT_REQUIRED_BUT_MISSING;
            }
        }
    }
    if(flags!==undefined){
        flags.operator = operator;
        return flags
    }
    return operator;
};


Validator.type = function(desired_type, required, flags) {

    if((typeof required)==="object"){
        flags = required;
        required = typeof flags.required !== 'undefined' ? flags.required : true;
    }

    var operator = function(value, emit) {

        var required_error = Validator.required(required)(value); 
        if(required_error) return required_error;

        var value_and_type = Validator.get_value_and_type(value, desired_type);

        var inner_desired_type = value_and_type.desired_type;
        var type = value_and_type.type;
        var value = value_and_type.value;

        if (type !== inner_desired_type) {
            return {
                error_message: "Incorrect field type. Expected " + inner_desired_type + ".",
                error: Validator.INCORRECT_FIELD_TYPE,
                expected: inner_desired_type,
                received: type
            };
        }
        if(emit){
            emit(value);
        }
    }
    if(flags!==undefined){
        flags.operator = operator;
        return flags
    }
    return operator;
}

Validator.prototype = {

    default: function(default_value){
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
    },

    get: function(field_name) {//Additional arguments are operators
        var fv = this;

        var value = fv.validating[field_name];

        fv.recognized_keys[field_name] = true;

        if (arguments.length > 1) {
            //Additional checks

            var operators = Array.prototype.slice.call(arguments,1);
            value = Validator.use_operators(value, operators, fv, field_name);
        }

        return value;
    },

    //Top level error - something that cannot be assigned to a particular key
    error: function(error){
        var fv = this;

        fv.errors.push(error);

        return fv;
    },

    invalid: function(field_name, error) {
        var fv = this;

        var existing = fv.invalid_keys[field_name];
        if (existing != null) {
            //Add to an existing error
            if (existing.errors != null) {
                existing.errors.push(error);
            } else {
                fv.invalid_keys[field_name] = {
                    error: Validator.MULTIPLE_ERRORS,
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

    missing: function(field_name) {
        var fv = this;

        fv.missing_keys[field_name] = {
            error_message: "Field missing.",
            error: Validator.FIELD_MISSING
        };
        fv.missing_count++;
        return fv;
    },

    unrecognized: function(field_name) {
        var fv = this;

        fv.unrecognized_keys[field_name] = {
            error_message: "Unrecognized field.",
            error: Validator.FIELD_UNRECOGNIZED
        };
        fv.unrecognized_count++;
        return fv;
    },

    recognized: function(field_name){
        var fv = this;

        fv.recognized_keys[field_name] = true;

        return fv;
    },

    //Exists to allow processing of remaining keys after known keys are checked
    get_unrecognized: function(){
        var fv = this;

        var unrecognized = [];
        for (var key in fv.validating) {
            if (fv.recognized_keys[key] != true) {
                unrecognized.push(key);
            }
        }
        return unrecognized;
    },

    end: function() {
        var fv = this;

        var returning = {};

        var has_error = false;

        var unrecognized = fv.get_unrecognized();
        for(var key in unrecognized){
            fv.unrecognized(unrecognized[key]);
        }

        if(fv.missing_count !== 0) {
            returning.missing = fv.missing_keys;
            has_error = true;
        }
        if(fv.invalid_count !== 0) {
            returning.invalid = fv.invalid_keys;
            has_error = true;
        }
        if(fv.unrecognized_count !== 0) {
            returning.unrecognized = fv.unrecognized_keys;
            has_error = true;
        }

        if (has_error) {
            returning.error_message = "One or more errors.";
            returning.error = Validator.ONE_OR_MORE_ERRORS;

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
                    error: Validator.MULTIPLE_ERRORS,
                    error_message: "Multiple errors.",
                    errors: fv.errors
                }
            }
        }

        return null;
    }
}

Validator.Error = function(number, message, data) {
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
    module.exports = Validator;
}
var _validator_ref;

if((typeof require) === 'function'){
    _validator_ref = require("fieldval");
} else {
    _validator_ref = Validator;
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
        invalid_email: function(prefix) {
            return {
                error: 107,
                error_message: "Invalid email address format."
            }
        },
        invalid_url: function(prefix) {
            return {
                error: 108,
                error_message: "Invalid url format."
            }
        }
    },
    integer: function(required,flags){
        return _validator_ref.type("integer",required,flags);
    },
    number: function(required,flags){
        return _validator_ref.type("number",required,flags);
    },
    array: function(required,flags){
        return _validator_ref.type("array",required,flags);
    },
    object: function(required,flags){
        return _validator_ref.type("object",required,flags);
    },
    float: function(required,flags){
        return _validator_ref.type("float",required,flags);
    },
    boolean: function(required,flags){
        return _validator_ref.type("boolean",required,flags);
    },
    string: function(required,flags){
        var operator = function(value, emit) {
            //Passing emit means that the value can be changed
            var error = _validator_ref.type("string",required,flags)(value,emit);
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
        if(flags!==undefined){
            flags.operator = operator;
            return flags
        }
        return operator;
    },
    min_length: function(min_len, flags) {
        var operator = function(value) {
            if (value.length < min_len) {
                return BasicVal.errors.too_short(min_len)
            }
        }
        if(flags!==undefined){
            flags.operator = operator;
            return flags
        }
        return operator;
    },
    max_length: function(max_len, flags) {
        var operator = function(value) {
            if (value.length > max_len) {
                return BasicVal.errors.too_long(max_len);
            }
        }
        if(flags!==undefined){
            flags.operator = operator;
            return flags
        }
        return operator;
    },
    minimum: function(min_val, flags) {
        var operator = function(value) {
            if (value < min_val) {
                return BasicVal.errors.too_small(min_val);
            }
        }
        if(flags!==undefined){
            flags.operator = operator;
            return flags
        }
        return operator;
    },
    maximum: function(max_val, flags) {
        var operator = function(value) {
            if (value > max_val) {
                return BasicVal.errors.too_large(max_val);
            }
        }
        if(flags!==undefined){
            flags.operator = operator;
            return flags
        }
        return operator;
    },
    range: function(min_val, max_val, flags) {
        //Effectively combines minimum and maximum
        var operator = function(value){
            if (value < min_val) {
                return BasicVal.errors.too_small(min_val);
            } else if (value > max_val) {
                return BasicVal.errors.too_large(max_val);
            }
        }
        if(flags!==undefined){
            flags.operator = operator;
            return flags
        }
        return operator;
    },
    one_of: function(array, flags) {
        var valid_values = [];
        for(var i = 0; i < array.length; i++){
            var option = array[i];
            if((typeof option) === 'object'){
                valid_values.push(option[0]);
            } else {
                valid_values.push(option);
            }
        }
        var operator = function(value) {
            if (valid_values.indexOf(value) === -1) {
                return BasicVal.errors.not_in_list();
            }
        }
        if(flags!==undefined){
            flags.operator = operator;
            return flags
        }
        return operator;
    },
    not_empty: function(trim, flags) {
        var operator = function(value) {
            if (trim) {
                if (value.trim().length === 0) {
                    return BasicVal.errors.cannot_be_empty();
                }
            } else {
                if (value.length === 0) {
                    return BasicVal.errors.cannot_be_empty();
                }
            }
        }
        if(flags!==undefined){
            flags.operator = operator;
            return flags
        }
        return operator;
    },
    prefix: function(prefix, flags) {
        var operator = function(value) {
            if (value.length >= prefix.length) {
                if (value.substring(0, prefix.length) != prefix) {
                    return BasicVal.errors.no_prefix(prefix);
                }
            } else {
                return BasicVal.errors.no_prefix(prefix);
            }
        }
        if(flags!==undefined){
            flags.operator = operator;
            return flags
        }
        return operator;
    },
    each: function(on_each, flags) {
        var operator = function(array, stop) {
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
        if(flags!==undefined){
            flags.operator = operator;
            return flags
        }
        return operator;
    },
    email: function(flags){
        var operator = function(value) {
            var re = BasicVal.email_regex;
            if(!re.test(value)){
                return BasicVal.errors.invalid_email();
            } 
        }
        if(flags!==undefined){
            flags.operator = operator;
            return flags
        }
        return operator;
    },
    url: function(flags){
        var operator = function(value) {
            var re = BasicVal.url_regex;
            if(!re.test(value)){
                return BasicVal.errors.invalid_url();
            } 
        }
        if(flags!==undefined){
            flags.operator = operator;
            return flags
        }
        return operator;
    }
}

BasicVal.email_regex = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
BasicVal.url_regex = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;

if (typeof module != 'undefined') {
    module.exports = BasicVal;
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
        parent.add_field(field.name, new TextField(field.display_name || field.name));
    }
}

TextRuleField.prototype.init = function() {
    var field = this;

    field.min_length = field.validator.get("min_length", BasicVal.integer(false));
    if (field.min_length != null) {
        if (field.for_search) {
            fieldErrors.getOrMakeInvalid().put("min_length", new ValidatorError(57).error);
        } else {
            if (field.min_length < 1) {
                fieldErrors.getOrMakeInvalid().put("min_length", new ValidatorError(24).error);
            }
        }
    }

    field.max_length = field.validator.get("max_length", BasicVal.integer(false));
    if (field.max_length != null) {

        if (field.for_search) {
            fieldErrors.getOrMakeInvalid().put("max_length", new ValidatorError(57).error);
        } else {
            if (field.max_length < 1) {
                fieldErrors.getOrMakeInvalid().put("max_length", new ValidatorError(24).error);
            }

        }
    }

    field.phrase = field.validator.get("phrase", BasicVal.string(false));
    if (field.phrase != null) {
        if (!for_search) {
            fieldErrors.getOrMakeInvalid().put("phrase", new ValidatorError(65).error);
        }
    }

    field.equal_to = field.validator.get("equal_to", BasicVal.string(false));
    if (field.equal_to != null) {
        if (!for_search) {
            fieldErrors.getOrMakeInvalid().put("equal_to", new ValidatorError(65).error);
        }
    }

    field.ci_equal_to = field.validator.get("ci_equal_to", BasicVal.string(false));
    if (field.ci_equal_to != null) {
        if (!for_search) {
            fieldErrors.getOrMakeInvalid().put("ci_equal_to", new ValidatorError(65).error);
        }
    }

    field.prefix = field.validator.get("prefix", BasicVal.string(false));
    if (field.prefix != null) {
        if (!for_search) {
            fieldErrors.getOrMakeInvalid().put("prefix", new ValidatorError(65).error);
        }
    }

    field.ci_prefix = field.validator.get("ci_prefix", BasicVal.string(false));
    if (field.ci_prefix != null) {
        if (!for_search) {
            fieldErrors.getOrMakeInvalid().put("ci_prefix", new ValidatorError(65).error);
        }
    }

    field.query = field.validator.get("query", BasicVal.string(false));
    if (field.query != null) {
        if (!for_search) {
            fieldErrors.getOrMakeInvalid().put("query", new ValidatorError(65).error);
        }
    }

    return field.validator.end();
}

TextRuleField.prototype.create_operators = function(){
    var field = this;

    field.operators.push(BasicVal.string(field.required));

    if(field.min_length){
        field.operators.push(BasicVal.min_length(field.min_length,{stop_on_error:false}));
    }
    if(field.max_length){
        field.operators.push(BasicVal.max_length(field.max_length,{stop_on_error:false}));
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
        parent.add_field(field.name, new TextField(field.display_name || field.name,"number"));
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

NumberRuleField.prototype.create_operators = function(){
    var field = this;
    
    field.operators.push(BasicVal.number(field.required));

    if(field.minimum){
        field.operators.push(BasicVal.minimum(field.minimum,{stop_on_error:false}));
    }
    if(field.maximum){
        field.operators.push(BasicVal.maximum(field.maximum,{stop_on_error:false}));
    }
    if(field.integer){
        field.operators.push(BasicVal.integer(false,{stop_on_error:false}));
    }
}
fieldval_rules_extend(NestedRuleField, RuleField);

function NestedRuleField(json, validator) {
    var field = this;

    NestedRuleField.superConstructor.call(this, json, validator);
}

NestedRuleField.prototype.create_ui = function(parent,form){
    var field = this;

    if(ObjectField){
        var object_field;
        if(form){
            object_field = form;
        } else {
            object_field = new ObjectField(field.display_name || field.name);
        }

        for(var i in field.fields){
            var inner_field = field.fields[i];
            inner_field.create_ui(object_field);
        }

        if(!form){
            parent.add_field(field.name, object_field);
        }
    }
}

NestedRuleField.prototype.init = function() {
    var field = this;

    field.fields = {};

    var fields_json = field.validator.get("fields", BasicVal.object(false));
    if (fields_json != null) {
        var fields_validator = new Validator(null);

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

NestedRuleField.prototype.create_operators = function(validator){
    var field = this;

    field.operators.push(BasicVal.object(field.required));

    field.operators.push(function(value,emit){

        var inner_validator = new Validator(value);

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
        parent.add_field(field.name, new ChoiceField(field.display_name || field.name, field.choices));
    }
}

ChoiceRuleField.prototype.init = function() {
    var field = this;

    field.choices = field.validator.get("choices", BasicVal.array(true));

    return field.validator.end();
}

ChoiceRuleField.prototype.create_operators = function(){
    var field = this;

    field.operators.push(Validator.required(true))
    if(field.choices){
        field.operators.push(BasicVal.one_of(field.choices,{stop_on_error:false}));
    }
}

function RuleField(json, validator) {
    var field = this;

    field.json = json;
    field.operators = [];
    field.validator = (typeof validator != 'undefined') ? validator : new Validator(json);

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
    number: NumberRuleField,
    nested: NestedRuleField,
    choice: ChoiceRuleField
};

RuleField.create_field = function(json) {
    var field = null;

    var validator = new Validator(json);

    var type = validator.get("type", BasicVal.string(true), BasicVal.one_of([
        "nested","text","number","choice"//Need to improve structure
    ]));

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

    field.create_operators();

    return [null, field];
}

RuleField.prototype.validate_as_field = function(name, validator){
    var field = this;

    var value = validator.get(name, field.operators);

    return value;
}

RuleField.prototype.validate = function(value){
    var field = this;

    var validator = new Validator(null);

    var value = Validator.use_operators(value, field.operators, validator);

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
function Form(fields){
	var form = this;

	form.element = $("<form />").addClass("fieldval_ui_form").append(
		form.error_message = $("<div />").addClass("error_message").hide()
	).on("submit",function(event){
        event.preventDefault();
        form.submit();
	});

	form.fields = fields || {};

	//Used because ObjectField uses some Form.prototype functions
	form.fields_element = form.element;

	form.submit_callbacks = [];
}

Form.prototype.on_submit = function(callback){
	var form = this;

	form.submit_callbacks.push(callback);

	return form;
}

Form.prototype.submit = function(){
	var form = this;

	var compiled = form.val();

	for(var i = 0; i < form.submit_callbacks.length; i++){
		var callback = form.submit_callbacks[i];

		callback(compiled);
	}

	//returns compiled as well as invoking callback
	return compiled;
}

Form.prototype.add_field = function(name, field){
	var form = this;

    field.container.appendTo(form.fields_element);
    form.fields[name] = field;
}

//Same as Form.error(null)
Form.prototype.clear_errors = function(){
	var form = this;
	form.error(null);
}

Form.prototype.fields_error = function(error){
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

Form.prototype.show_error = function(){
    var form = this;
    form.error_message.show();
}

Form.prototype.hide_error = function(){
    var form = this;
    form.error_message.hide();
}

Form.prototype.error = function(error) {
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

Form.prototype.disable = function(){
	var form = this;

	for(var i in form.fields){
		var field = form.fields[i];
		field.disable();
	}
}

Form.prototype.enable = function(){
	var form = this;

	for(var i in form.fields){
		var field = form.fields[i];
		field.enable();
	}	
}

Form.prototype.val = function(set_val){
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
function Field(name, properties) {
    var field = this;

    field.properties = properties || {};

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

    if(field.properties.description){
        $("<div />").text(field.properties.description).insertAfter(field.title);
    }
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

function TextField(name, properties) {
    var field = this;

    if(typeof properties === 'string'){
        field.input_type = properties;
        properties = null;
    }

    field.properties = properties || {};

    if(!field.input_type){
        field.input_type = field.properties.type || "text"
    }

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

TextField.numeric_regex = /^-?\d+(\.\d+)?$/;

TextField.prototype.val = function(set_val) {
    var field = this;

    if (arguments.length===0) {
        var value = field.input.val();
        if(value.length===0){
            return null;
        }
        if(field.input_type==="number" && TextField.numeric_regex.test(value)){
            return parseFloat(value);
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

function DisplayField(name) {
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

function ChoiceField(name, choices, allow_empty) {
    var field = this;

    ChoiceField.superConstructor.call(this, name);

    field.element.addClass("choice_field");

    field.select = $("<select/>")
    .addClass("choice_input")
    .on("change",function(){
        field.did_change()
    })
    .appendTo(field.input_holder);

    field.choice_values = [];

    if(allow_empty){
        var option = $("<option />").attr("value",null).text("")
        field.select.append(option);
    }

    for(var i = 0; i < choices.length; i++){
        var choice = choices[i];

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
            console.log(set_val);
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

	Form.prototype.fields_error.call(this,error);

    ObjectField.superClass.error.call(this,error);
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
    	fieldval: Validator,
    	bval: BasicVal,
    	rule: ValidationRule
    };
}