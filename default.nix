{ mkDerivation, base, containers, ghcjs-base, ghcjs-ffiqq
, ghcjs-prim, split, stdenv, template-haskell
}:
mkDerivation {
  pname = "ghcjs-vdom";
  version = "0.1.0.0";
  src = ./.;
  isLibrary = true;
  isExecutable = true;
  buildDepends = [
    base containers ghcjs-base ghcjs-ffiqq ghcjs-prim split
    template-haskell
  ];
  description = "Experimental virtual-dom bindings for GHCJS";
  license = stdenv.lib.licenses.mit;
}
