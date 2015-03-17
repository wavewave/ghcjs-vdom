(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*
   vtree/diff module modified to defer rendering thunks. this makes it possible to
   implement thunks that cannot be called directly as a function, but have
   an asynchronous callback or require evaluation in some specific runtime
   environment
 */

var isArray = require("x-is-array")
var isObject = require("is-object")

var VPatch = require("virtual-dom/vnode/vpatch")
var isVNode = require("virtual-dom/vnode/is-vnode")
var isVText = require("virtual-dom/vnode/is-vtext")
var isWidget = require("virtual-dom/vnode/is-widget")
var isThunk = require("virtual-dom/vnode/is-thunk")
var handleThunk = require("./handle-thunk")

module.exports = diff

// how to implement original behaviour for deferred thunks
/*
function diffOrig(a, b) {
    var thunks = [];
    var patch = diff(a, b, thunks);
    if(thunks.length) {
        var work = [];
        var newThunks = [];
        do {
            for(var i=thunks.length-1;i>=0;i--) {
                var t = thunks[i];
                t.a.vnode = t.a.vnode || // call (custom?) render function here
                t.b.vnode = t.b.vnode || // call (custom?) render function here
                t.p[t.i] = diff(t.a.vnode, t.b.vnode, newThunks);
                if(newThunks.length) {
                    work.push(newThunks);
                    newThunks = [];
                }
            }
        } while(thunks = work.pop());
    }
    return patch;
}
*/
// ...


function diff(a, b, thunks) {
    var patch  = { a: a };
    thunks = thunks || [];
    walk(a, b, patch, thunks, 0)
    return patch
}

function walk(a, b, patch, thunks, index) {
    if (a === b) {
        if (isThunk(a) || isThunk(b)) {
            doThunks(a, b, patch, thunks, index)
        } else {
            hooks(b, patch, index)
        }
        return
    }

    var apply = patch[index]

    if (b == null) {
        apply = appendPatch(apply, new VPatch(VPatch.REMOVE, a, b))
        destroyWidgets(a, patch, index)
    } else if (isThunk(a) || isThunk(b)) {
        doThunks(a, b, patch, thunks, index)
    } else if (isVNode(b)) {
        if (isVNode(a)) {
            if (a.tagName === b.tagName &&
                a.namespace === b.namespace &&
                a.key === b.key) {
                var propsPatch = diffProps(a.properties, b.properties, b.hooks)
                if (propsPatch) {
                    apply = appendPatch(apply,
                        new VPatch(VPatch.PROPS, a, propsPatch))
                }
            } else {
                apply = appendPatch(apply, new VPatch(VPatch.VNODE, a, b))
                destroyWidgets(a, patch, index)
            }

            apply = diffChildren(a, b, patch, apply, thunks, index)
        } else {
            apply = appendPatch(apply, new VPatch(VPatch.VNODE, a, b))
            destroyWidgets(a, patch, index)
        }
    } else if (isVText(b)) {
        if (!isVText(a)) {
            apply = appendPatch(apply, new VPatch(VPatch.VTEXT, a, b))
            destroyWidgets(a, patch, index)
        } else if (a.text !== b.text) {
            apply = appendPatch(apply, new VPatch(VPatch.VTEXT, a, b))
        }
    } else if (isWidget(b)) {
        apply = appendPatch(apply, new VPatch(VPatch.WIDGET, a, b))

        if (!isWidget(a)) {
            destroyWidgets(a, patch, index)
        }
    }

    if (apply) {
        patch[index] = apply
    }
}

function diffProps(a, b, hooks) {
    var diff

    for (var aKey in a) {
        if (!(aKey in b)) {
            diff = diff || {}
            diff[aKey] = undefined
        }

        var aValue = a[aKey]
        var bValue = b[aKey]

        if (hooks && aKey in hooks) {
            diff = diff || {}
            diff[aKey] = bValue
        } else {
            if (isObject(aValue) && isObject(bValue)) {
                if (getPrototype(bValue) !== getPrototype(aValue)) {
                    diff = diff || {}
                    diff[aKey] = bValue
                } else {
                    var objectDiff = diffProps(aValue, bValue)
                    if (objectDiff) {
                        diff = diff || {}
                        diff[aKey] = objectDiff
                    }
                }
            } else if (aValue !== bValue) {
                diff = diff || {}
                diff[aKey] = bValue
            }
        }
    }

    for (var bKey in b) {
        if (!(bKey in a)) {
            diff = diff || {}
            diff[bKey] = b[bKey]
        }
    }

    return diff
}

function getPrototype(value) {
    if (Object.getPrototypeOf) {
        return Object.getPrototypeOf(value)
    } else if (value.__proto__) {
        return value.__proto__
    } else if (value.constructor) {
        return value.constructor.prototype
    }
}

function diffChildren(a, b, patch, apply, thunks, index) {
    var aChildren = a.children
    var bChildren = reorder(aChildren, b.children)

    var aLen = aChildren.length
    var bLen = bChildren.length
    var len = aLen > bLen ? aLen : bLen

    for (var i = 0; i < len; i++) {
        var leftNode = aChildren[i]
        var rightNode = bChildren[i]
        index += 1

        if (!leftNode) {
            if (rightNode) {
                // Excess nodes in b need to be added
                apply = appendPatch(apply,
                    new VPatch(VPatch.INSERT, null, rightNode))
            }
        } else if (!rightNode) {
            if (leftNode) {
                // Excess nodes in a need to be removed
                patch[index] = new VPatch(VPatch.REMOVE, leftNode, null)
                destroyWidgets(leftNode, patch, index)
            }
        } else {
            walk(leftNode, rightNode, patch, thunks, index)
        }

        if (isVNode(leftNode) && leftNode.count) {
            index += leftNode.count
        }
    }

    if (bChildren.moves) {
        // Reorder nodes last
        apply = appendPatch(apply, new VPatch(VPatch.ORDER, a, bChildren.moves))
    }

    return apply
}

// Patch records for all destroyed widgets must be added because we need
// a DOM node reference for the destroy function
function destroyWidgets(vNode, patch, index) {
    if (isWidget(vNode)) {
        if (typeof vNode.destroy === "function") {
            patch[index] = new VPatch(VPatch.REMOVE, vNode, null)
        }
    } else if (isVNode(vNode) && vNode.hasWidgets) {
        var children = vNode.children
        var len = children.length
        for (var i = 0; i < len; i++) {
            var child = children[i]
            index += 1

            destroyWidgets(child, patch, index)

            if (isVNode(child) && child.count) {
                index += child.count
            }
        }
    }
}

// Create a sub-patch for thunks
function doThunks(a, b, patch, thunks, index) {
    var ts = handleThunk(a, b);
    if(ts.a || ts.b) {
        // defer rendering, caller is responsible for:
        //   - filling ts.a.vnode / ts.b.vnode with the result from the thunk
        //   - ts.p[t.sp] = new VPatch(VPatch.THUNK, null, diff(ts.a.vnode, ts.b.vnode))
        // before using it with patch
        thunks.push({ i: index, p: patch, a: a, b: b});
    } else {
        var thunkPatch = diff(a.vnode, b.vnode, thunks)
        if (hasPatches(thunkPatch)) {
            patch[index] = new VPatch(VPatch.THUNK, null, thunkPatch)
        }
    }
}

function hasPatches(patch) {
    for (var index in patch) {
        if (index !== "a") {
            return true;
        }
    }
    return false;
}

// Execute hooks when two nodes are identical
function hooks(vNode, patch, index) {
    if (isVNode(vNode)) {
        if (vNode.hooks) {
            patch[index] = new VPatch(VPatch.PROPS, vNode.hooks, vNode.hooks)
        }

        if (vNode.descendantHooks) {
            var children = vNode.children
            var len = children.length
            for (var i = 0; i < len; i++) {
                var child = children[i]
                index += 1

                hooks(child, patch, index)

                if (isVNode(child) && child.count) {
                    index += child.count
                }
            }
        }
    }
}

// List diff, naive left to right reordering
function reorder(aChildren, bChildren) {

    var bKeys = keyIndex(bChildren)

    if (!bKeys) {
        return bChildren
    }

    var aKeys = keyIndex(aChildren)

    if (!aKeys) {
        return bChildren
    }

    var bMatch = {}, aMatch = {}

    for (var key in bKeys) {
        bMatch[bKeys[key]] = aKeys[key]
    }

    for (var key in aKeys) {
        aMatch[aKeys[key]] = bKeys[key]
    }

    var aLen = aChildren.length
    var bLen = bChildren.length
    var len = aLen > bLen ? aLen : bLen
    var shuffle = []
    var freeIndex = 0
    var i = 0
    var moveIndex = 0
    var moves = {}
    var removes = moves.removes = {}
    var reverse = moves.reverse = {}
    var hasMoves = false

    while (freeIndex < len) {
        var move = aMatch[i]
        if (move !== undefined) {
            shuffle[i] = bChildren[move]
            if (move !== moveIndex) {
                moves[move] = moveIndex
                reverse[moveIndex] = move
                hasMoves = true
            }
            moveIndex++
        } else if (i in aMatch) {
            shuffle[i] = undefined
            removes[i] = moveIndex++
            hasMoves = true
        } else {
            while (bMatch[freeIndex] !== undefined) {
                freeIndex++
            }

            if (freeIndex < len) {
                var freeChild = bChildren[freeIndex]
                if (freeChild) {
                    shuffle[i] = freeChild
                    if (freeIndex !== moveIndex) {
                        hasMoves = true
                        moves[freeIndex] = moveIndex
                        reverse[moveIndex] = freeIndex
                    }
                    moveIndex++
                }
                freeIndex++
            }
        }
        i++
    }

    if (hasMoves) {
        shuffle.moves = moves
    }

    return shuffle
}

function keyIndex(children) {
    var i, keys

    for (i = 0; i < children.length; i++) {
        var child = children[i]

        if (child.key !== undefined) {
            keys = keys || {}
            keys[child.key] = i
        }
    }

    return keys
}

function appendPatch(apply, patch) {
    if (apply) {
        if (isArray(apply)) {
            apply.push(patch)
        } else {
            apply = [apply, patch]
        }

        return apply
    } else {
        return patch
    }
}

},{"./handle-thunk":2,"is-object":8,"virtual-dom/vnode/is-thunk":19,"virtual-dom/vnode/is-vnode":21,"virtual-dom/vnode/is-vtext":22,"virtual-dom/vnode/is-widget":23,"virtual-dom/vnode/vpatch":26,"x-is-array":28}],2:[function(require,module,exports){
var isVNode = require("virtual-dom/vnode/is-vnode")
var isVText = require("virtual-dom/vnode/is-vtext")
var isWidget = require("virtual-dom/vnode/is-widget")
var isThunk = require("virtual-dom/vnode/is-thunk")

module.exports = handleThunk

function handleThunk(a, b) {
    return { a: isThunk(a) ? renderThunk(a, null) : null
           , b: isThunk(b) ? renderThunk(b, a) : null
           }
}

function renderThunk(thunk, previous) {
    if(thunk.vnode) return null;
    thunk.render(previous);
    return thunk.vnode ? null : thunk;
}

},{"virtual-dom/vnode/is-thunk":19,"virtual-dom/vnode/is-vnode":21,"virtual-dom/vnode/is-vtext":22,"virtual-dom/vnode/is-widget":23}],3:[function(require,module,exports){
/*
  to generate lib.js, install virtual-dom and process file:

     $ npm install
     $ grunt
   the ./diff module is vtree/diff with a few changes to
   allow diff to run in an asynchronous thread in the presence of
   memoized nodes.
 */

var isHook = require('virtual-dom/vnode/is-vhook');

var isVirtualNode = require('virtual-dom/vnode/is-vnode');
var isThunk       = require('virtual-dom/vnode/is-thunk');
var isArray       = require('x-is-array');
var VPatch        = require("virtual-dom/vnode/vpatch")

/** @constructor */
function HSThunk(t, ids, key) {
    this.hst        = t;   // haskell thunk
    this.ids        = ids; // array of haskell unique ids
    this.key        = key;
    this.vnode      = null;
    this._ghcjsMark = 0;
}

HSThunk.prototype.type = 'Thunk';

// render returns the deferred rendering object
// null if the thunk has already been rendered, in which case the value is in this.vnode
HSThunk.prototype.render = function(previous) {
    if(previous && !this.vnode && eqIds(this.ids, previous.ids)) {
        if(previous.hst) {
            this.hst = previous.hst;
        } else {
            this.hst   = null;
            this.vnode = previous.vnode;
        }
    }
    return this.vnode ? null : this;
}

function eqIds(ids1, ids2) {
    if(ids1.length != ids2.length) return false;
    for(var i=ids1.length-1;i>=0;i--) {
        if(ids1[i] !== ids2[i]) return false;
    }
    return true;
}

function forcePatch(p) {
    var thunks = [], i, j, pi;
    for(i in p) {
        var pi = p[i];
        if(isArray(pi))
            for(j=pi.length-1;j>=0;j--) forceTree(pi[j].patch, thunks);
        else if(pi.patch) forceTree(pi.patch, thunks);
        else forceTree(pi, thunks);
    }
    return thunks;
}

function forceTree(n, t) {
    if(isThunk(n)) {
        if(n.vnode) forceTree(n.vnode, t);
        else t.push(n);
    } else if(isVirtualNode(n)) {
        for(var i=n.children.length-1;i>=0;i--) {
            forceTree(n.children[i], t);
        }
    }
}

// add support for more node types here when the bindings can construct them
function scanTree(o, currentMark) {
    if((isVirtualNode(o) || isThunk(o))) {
        if(o._ghcjsMark === currentMark) return true;
        var res = [];
        scanTreeRec(o, res, currentMark);
        return res.length ? res : true;
    } else return false;
}

function scanTreeRec(o, r, currentMark) {
    if(o instanceof HSThunk) {
        if(o._ghcjsMark !== currentMark) {
            o._ghcjsMark = currentMark;
            if(o.t) r.push(o.t);
            else scanTreeRec(o.vnode, r, currentMark);
        }
    } else if(isVirtualNode(o)) {
        if(o._ghcjsMark !== currentMark) {
            o._ghcjsMark = currentMark;
            for(var i=o.children.length-1;i>=0;i--) {
                scanTreeRec(o.children[i], r, currentMark);
            }
        }
    }
}

function setThunkPatch(n, p) {
    if(hasPatches(p)) n.p[n.i] = new VPatch(VPatch.THUNK, null, p);
}

function hasPatches(patch) {
    for (var index in patch) {
        if (index !== "a") {
            return true;
        }
    }
    return false;
}

var transformProperties = require('./transformProperties');

module.exports = { diff:          require('./diff')
                 , HSThunk:       HSThunk
                 , setThunkPatch: setThunkPatch
                 , forceTree:     forceTree
                 , forcePatch:    forcePatch
                   , isHook:      isHook
                 , VNode:         require('virtual-dom/vnode/vnode')
                 , VText:         require('virtual-dom/vnode/vtext')
                 , patch:         require('virtual-dom/vdom/patch')
                 , createElement: require('virtual-dom/vdom/create-element')
                 // for event registration hook               
                 , transformProperties: transformProperties.transformProperties
                 // ultra deep clone
                 , UltraDeepClone: require('udc/udc')
                 };

// the global variable we're using in the bindings
h$vdom = module.exports;
h$registerExtensibleRetention(scanTree);

},{"./diff":1,"./transformProperties":29,"udc/udc":9,"virtual-dom/vdom/create-element":13,"virtual-dom/vdom/patch":16,"virtual-dom/vnode/is-thunk":19,"virtual-dom/vnode/is-vhook":20,"virtual-dom/vnode/is-vnode":21,"virtual-dom/vnode/vnode":25,"virtual-dom/vnode/vpatch":26,"virtual-dom/vnode/vtext":27,"x-is-array":28}],4:[function(require,module,exports){
'use strict';

var OneVersionConstraint = require('individual/one-version');

var MY_VERSION = '7';
OneVersionConstraint('ev-store', MY_VERSION);

var hashKey = '__EV_STORE_KEY@' + MY_VERSION;

module.exports = EvStore;

function EvStore(elem) {
    var hash = elem[hashKey];

    if (!hash) {
        hash = elem[hashKey] = {};
    }

    return hash;
}

},{"individual/one-version":6}],5:[function(require,module,exports){
(function (global){
'use strict';

/*global window, global*/

var root = typeof window !== 'undefined' ?
    window : typeof global !== 'undefined' ?
    global : {};

module.exports = Individual;

function Individual(key, value) {
    if (key in root) {
        return root[key];
    }

    root[key] = value;

    return value;
}

}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],6:[function(require,module,exports){
'use strict';

var Individual = require('./index.js');

module.exports = OneVersion;

function OneVersion(moduleName, version, defaultValue) {
    var key = '__INDIVIDUAL_ONE_VERSION_' + moduleName;
    var enforceKey = key + '_ENFORCE_SINGLETON';

    var versionValue = Individual(enforceKey, version);

    if (versionValue !== version) {
        throw new Error('Can only have one copy of ' +
            moduleName + '.\n' +
            'You already have version ' + versionValue +
            ' installed.\n' +
            'This means you cannot install version ' + version);
    }

    return Individual(key, defaultValue);
}

},{"./index.js":5}],7:[function(require,module,exports){

},{}],8:[function(require,module,exports){
module.exports = isObject

function isObject(x) {
    return typeof x === "object" && x !== null
}

},{}],9:[function(require,module,exports){
(function (root, factory) {
		"use strict";

		if (typeof exports === 'object') {
			module.exports = factory();
		} else if (typeof define === 'function' && define.amd) {
			define(factory);
		} else {
			root.UltraDeepClone = factory();
		}
	}(this, function () {

		var functionPropertyFilter = [
			"caller",
			"arguments"
		];

		// Node.js has a lot of silly enumeral properties on its "TypedArray" implementation
		var typedArrayPropertyFilter = [
			'BYTES_PER_ELEMENT',
			'get',
			'set',
			'slice',
			'subarray',
			'buffer',
			'length',
			'byteOffset',
			'byteLength'
		];

		var primitiveCloner  = makeCloner(clonePrimitive);
		var typedArrayCloner = makeRecursiveCloner(makeCloner(cloneTypedArray), typedArrayPropertyFilter);

		function typeString (type) {
			return '[object ' + type + ']';
		}

		var cloneFunctions = {};

		cloneFunctions[typeString('RegExp')] = makeCloner(cloneRegExp);
		cloneFunctions[typeString('Date')] = makeCloner(cloneDate);
		cloneFunctions[typeString('Function')] = makeRecursiveCloner(makeCloner(cloneFunction), functionPropertyFilter);
		cloneFunctions[typeString('Object')] = makeRecursiveCloner(makeCloner(cloneObject));
		cloneFunctions[typeString('Array')] = makeRecursiveCloner(makeCloner(cloneArray));

		['Null', 'Undefined', 'Number', 'String', 'Boolean']
			.map(typeString)
			.forEach(function (type) {
				cloneFunctions[type] = primitiveCloner;
			});

		['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
		 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array']
			.map(typeString)
			.forEach(function (type) {
				cloneFunctions[type] = typedArrayCloner;
			});

		function makeArguments (numberOfArgs) {
			var letters = [];
			for ( var i = 1; i <= numberOfArgs; i++ ) letters.push("arg" + i);
			return letters;
		}

		function wrapFunctionWithArity (callback) {
			var argList = makeArguments(callback.length);
			var functionCode = 'return false || function ';
			functionCode += callback.name + '(';
			functionCode += argList.join(', ') + ') {\n';
			functionCode += 'return fn.apply(this, arguments);\n';
			functionCode += '};'

			return Function("fn", functionCode)(callback);
		}

		function makeCloner (cloneThing) {
			return function(thing, thingStack, copyStack) {
				thingStack.push(thing);
				var copy = cloneThing(thing);
				copyStack.push(copy);
				return copy;
			};
		}

		function clonePrimitive (primitive) {
			return primitive;
		}

		function cloneRegExp (regexp) {
			return new RegExp(regexp);
		}

		function cloneDate (date) {
			return new Date(date.getTime());
		}

		// We can't really clone functions but we can wrap them in a new function that will
		// recieve clones of any properties the original function may have had
		function cloneFunction (fn) {
			return wrapFunctionWithArity(fn);
		}

		// This will not properly clone `constructed` objects because
		// it is impossible to know with what arguments the constructor
		// was originally invoked.
		function cloneObject (object) {
			return Object.create(Object.getPrototypeOf(object));
		}

		function cloneArray (array) {
			return [];
		}

		function cloneTypedArray (typedArray) {
			var len = typedArray.length;
			return new typedArray.constructor(len);
		}

		function makeRecursiveCloner (cloneThing, propertyFilter) {
			return function(thing, thingStack, copyStack) {
				var clone = this;

				return Object.getOwnPropertyNames(thing)
					.filter(function(prop){
						return !propertyFilter || propertyFilter.indexOf(prop) === -1;
					})
					.reduce(function(copy, prop) {
						var thingOffset = thingStack.indexOf(thing[prop]);

						if (thingOffset === -1) {
							copy[prop] = clone(thing[prop]);
						} else {
							copy[prop] = copyStack[thingOffset];
						}

						return copy;
					}, cloneThing(thing, thingStack, copyStack));
			};
		}

		return function _ultraDeepClone (source) {

			var thingStack = [];
			var copyStack = [];

			function clone (thing) {
				var typeOfThing = Object.prototype.toString.call(thing);
				return cloneFunctions[typeOfThing].call(clone, thing, thingStack, copyStack);
			};

			return clone(source);
		};
}));

},{}],10:[function(require,module,exports){
(function (global){
var topLevel = typeof global !== 'undefined' ? global :
    typeof window !== 'undefined' ? window : {}
var minDoc = require('min-document');

if (typeof document !== 'undefined') {
    module.exports = document;
} else {
    var doccy = topLevel['__GLOBAL_DOCUMENT_CACHE@4'];

    if (!doccy) {
        doccy = topLevel['__GLOBAL_DOCUMENT_CACHE@4'] = minDoc;
    }

    module.exports = doccy;
}

}).call(this,typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"min-document":7}],11:[function(require,module,exports){
"use strict";

module.exports = function isObject(x) {
	return typeof x === "object" && x !== null;
};

},{}],12:[function(require,module,exports){
var isObject = require("is-object")
var isHook = require("../vnode/is-vhook.js")

module.exports = applyProperties

function applyProperties(node, props, previous) {
    for (var propName in props) {
        var propValue = props[propName]

        if (propValue === undefined) {
            removeProperty(node, propName, propValue, previous);
        } else if (isHook(propValue)) {
            removeProperty(node, propName, propValue, previous)
            if (propValue.hook) {
                propValue.hook(node,
                    propName,
                    previous ? previous[propName] : undefined)
            }
        } else {
            if (isObject(propValue)) {
                patchObject(node, props, previous, propName, propValue);
            } else {
                node[propName] = propValue
            }
        }
    }
}

function removeProperty(node, propName, propValue, previous) {
    if (previous) {
        var previousValue = previous[propName]

        if (!isHook(previousValue)) {
            if (propName === "attributes") {
                for (var attrName in previousValue) {
                    node.removeAttribute(attrName)
                }
            } else if (propName === "style") {
                for (var i in previousValue) {
                    node.style[i] = ""
                }
            } else if (typeof previousValue === "string") {
                node[propName] = ""
            } else {
                node[propName] = null
            }
        } else if (previousValue.unhook) {
            previousValue.unhook(node, propName, propValue)
        }
    }
}

function patchObject(node, props, previous, propName, propValue) {
    var previousValue = previous ? previous[propName] : undefined

    // Set attributes
    if (propName === "attributes") {
        for (var attrName in propValue) {
            var attrValue = propValue[attrName]

            if (attrValue === undefined) {
                node.removeAttribute(attrName)
            } else {
                node.setAttribute(attrName, attrValue)
            }
        }

        return
    }

    if(previousValue && isObject(previousValue) &&
        getPrototype(previousValue) !== getPrototype(propValue)) {
        node[propName] = propValue
        return
    }

    if (!isObject(node[propName])) {
        node[propName] = {}
    }

    var replacer = propName === "style" ? "" : undefined

    for (var k in propValue) {
        var value = propValue[k]
        node[propName][k] = (value === undefined) ? replacer : value
    }
}

function getPrototype(value) {
    if (Object.getPrototypeOf) {
        return Object.getPrototypeOf(value)
    } else if (value.__proto__) {
        return value.__proto__
    } else if (value.constructor) {
        return value.constructor.prototype
    }
}

},{"../vnode/is-vhook.js":20,"is-object":11}],13:[function(require,module,exports){
var document = require("global/document")

var applyProperties = require("./apply-properties")

var isVNode = require("../vnode/is-vnode.js")
var isVText = require("../vnode/is-vtext.js")
var isWidget = require("../vnode/is-widget.js")
var handleThunk = require("../vnode/handle-thunk.js")

module.exports = createElement

function createElement(vnode, opts) {
    var doc = opts ? opts.document || document : document
    var warn = opts ? opts.warn : null

    vnode = handleThunk(vnode).a

    if (isWidget(vnode)) {
        return vnode.init()
    } else if (isVText(vnode)) {
        return doc.createTextNode(vnode.text)
    } else if (!isVNode(vnode)) {
        if (warn) {
            warn("Item is not a valid virtual dom node", vnode)
        }
        return null
    }

    var node = (vnode.namespace === null) ?
        doc.createElement(vnode.tagName) :
        doc.createElementNS(vnode.namespace, vnode.tagName)

    var props = vnode.properties
    applyProperties(node, props)

    var children = vnode.children

    for (var i = 0; i < children.length; i++) {
        var childNode = createElement(children[i], opts)
        if (childNode) {
            node.appendChild(childNode)
        }
    }

    return node
}

},{"../vnode/handle-thunk.js":18,"../vnode/is-vnode.js":21,"../vnode/is-vtext.js":22,"../vnode/is-widget.js":23,"./apply-properties":12,"global/document":10}],14:[function(require,module,exports){
// Maps a virtual DOM tree onto a real DOM tree in an efficient manner.
// We don't want to read all of the DOM nodes in the tree so we use
// the in-order tree indexing to eliminate recursion down certain branches.
// We only recurse into a DOM node if we know that it contains a child of
// interest.

var noChild = {}

module.exports = domIndex

function domIndex(rootNode, tree, indices, nodes) {
    if (!indices || indices.length === 0) {
        return {}
    } else {
        indices.sort(ascending)
        return recurse(rootNode, tree, indices, nodes, 0)
    }
}

function recurse(rootNode, tree, indices, nodes, rootIndex) {
    nodes = nodes || {}


    if (rootNode) {
        if (indexInRange(indices, rootIndex, rootIndex)) {
            nodes[rootIndex] = rootNode
        }

        var vChildren = tree.children

        if (vChildren) {

            var childNodes = rootNode.childNodes

            for (var i = 0; i < tree.children.length; i++) {
                rootIndex += 1

                var vChild = vChildren[i] || noChild
                var nextIndex = rootIndex + (vChild.count || 0)

                // skip recursion down the tree if there are no nodes down here
                if (indexInRange(indices, rootIndex, nextIndex)) {
                    recurse(childNodes[i], vChild, indices, nodes, rootIndex)
                }

                rootIndex = nextIndex
            }
        }
    }

    return nodes
}

// Binary search for an index in the interval [left, right]
function indexInRange(indices, left, right) {
    if (indices.length === 0) {
        return false
    }

    var minIndex = 0
    var maxIndex = indices.length - 1
    var currentIndex
    var currentItem

    while (minIndex <= maxIndex) {
        currentIndex = ((maxIndex + minIndex) / 2) >> 0
        currentItem = indices[currentIndex]

        if (minIndex === maxIndex) {
            return currentItem >= left && currentItem <= right
        } else if (currentItem < left) {
            minIndex = currentIndex + 1
        } else  if (currentItem > right) {
            maxIndex = currentIndex - 1
        } else {
            return true
        }
    }

    return false;
}

function ascending(a, b) {
    return a > b ? 1 : -1
}

},{}],15:[function(require,module,exports){
var applyProperties = require("./apply-properties")

var isWidget = require("../vnode/is-widget.js")
var VPatch = require("../vnode/vpatch.js")

var render = require("./create-element")
var updateWidget = require("./update-widget")

module.exports = applyPatch

function applyPatch(vpatch, domNode, renderOptions) {
    var type = vpatch.type
    var vNode = vpatch.vNode
    var patch = vpatch.patch

    switch (type) {
        case VPatch.REMOVE:
            return removeNode(domNode, vNode)
        case VPatch.INSERT:
            return insertNode(domNode, patch, renderOptions)
        case VPatch.VTEXT:
            return stringPatch(domNode, vNode, patch, renderOptions)
        case VPatch.WIDGET:
            return widgetPatch(domNode, vNode, patch, renderOptions)
        case VPatch.VNODE:
            return vNodePatch(domNode, vNode, patch, renderOptions)
        case VPatch.ORDER:
            reorderChildren(domNode, patch)
            return domNode
        case VPatch.PROPS:
            applyProperties(domNode, patch, vNode.properties)
            return domNode
        case VPatch.THUNK:
            return replaceRoot(domNode,
                renderOptions.patch(domNode, patch, renderOptions))
        default:
            return domNode
    }
}

function removeNode(domNode, vNode) {
    var parentNode = domNode.parentNode

    if (parentNode) {
        parentNode.removeChild(domNode)
    }

    destroyWidget(domNode, vNode);

    return null
}

function insertNode(parentNode, vNode, renderOptions) {
    var newNode = render(vNode, renderOptions)

    if (parentNode) {
        parentNode.appendChild(newNode)
    }

    return parentNode
}

function stringPatch(domNode, leftVNode, vText, renderOptions) {
    var newNode

    if (domNode.nodeType === 3) {
        domNode.replaceData(0, domNode.length, vText.text)
        newNode = domNode
    } else {
        var parentNode = domNode.parentNode
        newNode = render(vText, renderOptions)

        if (parentNode && newNode !== domNode) {
            parentNode.replaceChild(newNode, domNode)
        }
    }

    return newNode
}

function widgetPatch(domNode, leftVNode, widget, renderOptions) {
    var updating = updateWidget(leftVNode, widget)
    var newNode

    if (updating) {
        newNode = widget.update(leftVNode, domNode) || domNode
    } else {
        newNode = render(widget, renderOptions)
    }

    var parentNode = domNode.parentNode

    if (parentNode && newNode !== domNode) {
        parentNode.replaceChild(newNode, domNode)
    }

    if (!updating) {
        destroyWidget(domNode, leftVNode)
    }

    return newNode
}

function vNodePatch(domNode, leftVNode, vNode, renderOptions) {
    var parentNode = domNode.parentNode
    var newNode = render(vNode, renderOptions)

    if (parentNode && newNode !== domNode) {
        parentNode.replaceChild(newNode, domNode)
    }

    return newNode
}

function destroyWidget(domNode, w) {
    if (typeof w.destroy === "function" && isWidget(w)) {
        w.destroy(domNode)
    }
}

function reorderChildren(domNode, moves) {
    var childNodes = domNode.childNodes
    var keyMap = {}
    var node
    var remove
    var insert

    for (var i = 0; i < moves.removes.length; i++) {
        remove = moves.removes[i]
        node = childNodes[remove.from]
        if (remove.key) {
            keyMap[remove.key] = node
        }
        domNode.removeChild(node)
    }

    var length = childNodes.length
    for (var j = 0; j < moves.inserts.length; j++) {
        insert = moves.inserts[j]
        node = keyMap[insert.key]
        // this is the weirdest bug i've ever seen in webkit
        domNode.insertBefore(node, insert.to >= length++ ? null : childNodes[insert.to])
    }
}

function replaceRoot(oldRoot, newRoot) {
    if (oldRoot && newRoot && oldRoot !== newRoot && oldRoot.parentNode) {
        oldRoot.parentNode.replaceChild(newRoot, oldRoot)
    }

    return newRoot;
}

},{"../vnode/is-widget.js":23,"../vnode/vpatch.js":26,"./apply-properties":12,"./create-element":13,"./update-widget":17}],16:[function(require,module,exports){
var document = require("global/document")
var isArray = require("x-is-array")

var domIndex = require("./dom-index")
var patchOp = require("./patch-op")
module.exports = patch

function patch(rootNode, patches) {
    return patchRecursive(rootNode, patches)
}

function patchRecursive(rootNode, patches, renderOptions) {
    var indices = patchIndices(patches)

    if (indices.length === 0) {
        return rootNode
    }

    var index = domIndex(rootNode, patches.a, indices)
    var ownerDocument = rootNode.ownerDocument

    if (!renderOptions) {
        renderOptions = { patch: patchRecursive }
        if (ownerDocument !== document) {
            renderOptions.document = ownerDocument
        }
    }

    for (var i = 0; i < indices.length; i++) {
        var nodeIndex = indices[i]
        rootNode = applyPatch(rootNode,
            index[nodeIndex],
            patches[nodeIndex],
            renderOptions)
    }

    return rootNode
}

function applyPatch(rootNode, domNode, patchList, renderOptions) {
    if (!domNode) {
        return rootNode
    }

    var newNode

    if (isArray(patchList)) {
        for (var i = 0; i < patchList.length; i++) {
            newNode = patchOp(patchList[i], domNode, renderOptions)

            if (domNode === rootNode) {
                rootNode = newNode
            }
        }
    } else {
        newNode = patchOp(patchList, domNode, renderOptions)

        if (domNode === rootNode) {
            rootNode = newNode
        }
    }

    return rootNode
}

function patchIndices(patches) {
    var indices = []

    for (var key in patches) {
        if (key !== "a") {
            indices.push(Number(key))
        }
    }

    return indices
}

},{"./dom-index":14,"./patch-op":15,"global/document":10,"x-is-array":28}],17:[function(require,module,exports){
var isWidget = require("../vnode/is-widget.js")

module.exports = updateWidget

function updateWidget(a, b) {
    if (isWidget(a) && isWidget(b)) {
        if ("name" in a && "name" in b) {
            return a.id === b.id
        } else {
            return a.init === b.init
        }
    }

    return false
}

},{"../vnode/is-widget.js":23}],18:[function(require,module,exports){
var isVNode = require("./is-vnode")
var isVText = require("./is-vtext")
var isWidget = require("./is-widget")
var isThunk = require("./is-thunk")

module.exports = handleThunk

function handleThunk(a, b) {
    var renderedA = a
    var renderedB = b

    if (isThunk(b)) {
        renderedB = renderThunk(b, a)
    }

    if (isThunk(a)) {
        renderedA = renderThunk(a, null)
    }

    return {
        a: renderedA,
        b: renderedB
    }
}

function renderThunk(thunk, previous) {
    var renderedThunk = thunk.vnode

    if (!renderedThunk) {
        renderedThunk = thunk.vnode = thunk.render(previous)
    }

    if (!(isVNode(renderedThunk) ||
            isVText(renderedThunk) ||
            isWidget(renderedThunk))) {
        throw new Error("thunk did not return a valid node");
    }

    return renderedThunk
}

},{"./is-thunk":19,"./is-vnode":21,"./is-vtext":22,"./is-widget":23}],19:[function(require,module,exports){
module.exports = isThunk

function isThunk(t) {
    return t && t.type === "Thunk"
}

},{}],20:[function(require,module,exports){
module.exports = isHook

function isHook(hook) {
    return hook &&
      (typeof hook.hook === "function" && !hook.hasOwnProperty("hook") ||
       typeof hook.unhook === "function" && !hook.hasOwnProperty("unhook"))
}

},{}],21:[function(require,module,exports){
var version = require("./version")

module.exports = isVirtualNode

function isVirtualNode(x) {
    return x && x.type === "VirtualNode" && x.version === version
}

},{"./version":24}],22:[function(require,module,exports){
var version = require("./version")

module.exports = isVirtualText

function isVirtualText(x) {
    return x && x.type === "VirtualText" && x.version === version
}

},{"./version":24}],23:[function(require,module,exports){
module.exports = isWidget

function isWidget(w) {
    return w && w.type === "Widget"
}

},{}],24:[function(require,module,exports){
module.exports = "2"

},{}],25:[function(require,module,exports){
var version = require("./version")
var isVNode = require("./is-vnode")
var isWidget = require("./is-widget")
var isThunk = require("./is-thunk")
var isVHook = require("./is-vhook")

module.exports = VirtualNode

var noProperties = {}
var noChildren = []

function VirtualNode(tagName, properties, children, key, namespace) {
    this.tagName = tagName
    this.properties = properties || noProperties
    this.children = children || noChildren
    this.key = key != null ? String(key) : undefined
    this.namespace = (typeof namespace === "string") ? namespace : null

    var count = (children && children.length) || 0
    var descendants = 0
    var hasWidgets = false
    var hasThunks = false
    var descendantHooks = false
    var hooks

    for (var propName in properties) {
        if (properties.hasOwnProperty(propName)) {
            var property = properties[propName]
            if (isVHook(property) && property.unhook) {
                if (!hooks) {
                    hooks = {}
                }

                hooks[propName] = property
            }
        }
    }

    for (var i = 0; i < count; i++) {
        var child = children[i]
        if (isVNode(child)) {
            descendants += child.count || 0

            if (!hasWidgets && child.hasWidgets) {
                hasWidgets = true
            }

            if (!hasThunks && child.hasThunks) {
                hasThunks = true
            }

            if (!descendantHooks && (child.hooks || child.descendantHooks)) {
                descendantHooks = true
            }
        } else if (!hasWidgets && isWidget(child)) {
            if (typeof child.destroy === "function") {
                hasWidgets = true
            }
        } else if (!hasThunks && isThunk(child)) {
            hasThunks = true;
        }
    }

    this.count = count + descendants
    this.hasWidgets = hasWidgets
    this.hasThunks = hasThunks
    this.hooks = hooks
    this.descendantHooks = descendantHooks
}

VirtualNode.prototype.version = version
VirtualNode.prototype.type = "VirtualNode"

},{"./is-thunk":19,"./is-vhook":20,"./is-vnode":21,"./is-widget":23,"./version":24}],26:[function(require,module,exports){
var version = require("./version")

VirtualPatch.NONE = 0
VirtualPatch.VTEXT = 1
VirtualPatch.VNODE = 2
VirtualPatch.WIDGET = 3
VirtualPatch.PROPS = 4
VirtualPatch.ORDER = 5
VirtualPatch.INSERT = 6
VirtualPatch.REMOVE = 7
VirtualPatch.THUNK = 8

module.exports = VirtualPatch

function VirtualPatch(type, vNode, patch) {
    this.type = Number(type)
    this.vNode = vNode
    this.patch = patch
}

VirtualPatch.prototype.version = version
VirtualPatch.prototype.type = "VirtualPatch"

},{"./version":24}],27:[function(require,module,exports){
var version = require("./version")

module.exports = VirtualText

function VirtualText(text) {
    this.text = String(text)
}

VirtualText.prototype.version = version
VirtualText.prototype.type = "VirtualText"

},{"./version":24}],28:[function(require,module,exports){
var nativeIsArray = Array.isArray
var toString = Object.prototype.toString

module.exports = nativeIsArray || isArray

function isArray(obj) {
    return toString.call(obj) === "[object Array]"
}

},{}],29:[function(require,module,exports){
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
    es[propName] = this.value;
};

EvHook.prototype.unhook = function(node, propertyName) {
    var es = EvStore(node);
    var propName = propertyName.substr(3);
    es[propName] = undefined;
};

function transformProperties(props) {
    for(var propName in props) {
        if (props.hasOwnProperty(propName)) {
            var value = props[propName];

            if (isHook(value)) {
                continue;
            }

            if (propName.substr(0, 3) === 'ev-') {
                // add ev-foo support
                props[propName] = evHook(value);
            }
        }
    }
}

module.exports = { transformProperties: transformProperties };
},{"ev-store":4,"virtual-dom/vnode/is-vhook":20}]},{},[3]);