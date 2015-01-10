@import("../node_modules/fieldval/fieldval.js")
@import("../node_modules/fieldval-basicval/fieldval-basicval.js")
@import("../node_modules/fieldval-dateval/fieldval-dateval.js")
@import("../node_modules/fieldval-rules/fieldval-rules.js")
@import("../node_modules/fieldval-ui/fieldval-ui.js")

if (typeof module != 'undefined') {
    module.exports = {
    	fieldval: FieldVal,
    	basicval: BasicVal,
    	dateval: DateVal,
    	rules: ValidationRule
    };
}