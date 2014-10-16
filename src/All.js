@import("../bower_components/fieldval/fieldval.js")
@import("../bower_components/fieldval-basicval/fieldval-basicval.js")
@import("../bower_components/fieldval-dateval/fieldval-dateval.js")
@import("../bower_components/fieldval-rules/fieldval-rules.js")
@import("../bower_components/fieldval-ui/fieldval-ui.js")

if (typeof module != 'undefined') {
    module.exports = {
    	fieldval: FieldVal,
    	basicval: BasicVal,
    	dateval: DateVal,
    	rules: ValidationRule
    };
}