/* 
   transformProperties method added for event delegation  
 */

var isHook = require('virtual-dom/vnode/is-vhook');

var EvStore = require('ev-store');

var evHook = EvHook

function EvHook(value) {
    if (!(this instanceof EvHook)) {
        return new EvHook(value);
    }

    this.value = value;
}

EvHook.prototype.hook = function (node, propertyName) {
    var es = EvStore(node);
    var propName = propertyName.substr(3);
    console.log("EvHook.prototype.hook is called");
    es[propName] = this.value;
};

EvHook.prototype.unhook = function(node, propertyName) {
    var es = EvStore(node);
    var propName = propertyName.substr(3);
    console.log("EvHook.prototype.unhook is called");
    es[propName] = undefined;
};

function transformProperties(props) {
    for(var propName in props) {
        if (props.hasOwnProperty(propName)) {
            var value = props[propName];

            if (isHook(value)) {
                console.log("transformProperties, isHook: " + propName);
                continue;
            }

            if (propName.substr(0, 3) === 'ev-') {
                console.log("transformProperties, ev-: " + propName);

                // add ev-foo support
                props[propName] = evHook(value);
            }
        }
    }
}

module.exports = { transformProperties: transformProperties };