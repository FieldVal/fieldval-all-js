@import("../node_modules/fieldval/fieldval.js")
@import("../node_modules/fieldval-basicval/fieldval-basicval.js")
@import("../node_modules/fieldval-rules/fieldval-rules.js")
@import("../bower_components/fieldval-ui/fieldval-ui.js")

if (typeof module != 'undefined') {
    module.exports = {
    	fieldval: Validator,
    	bval: BasicVal,
    	rule: ValidationRule
    };
}