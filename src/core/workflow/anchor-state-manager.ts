import fs from 'node:fs';
import path from 'node:path';
import { diffLines } from 'diff';

interface LineState {
    anchor: string;
    text: string;
}

export class AnchorStateManager {
    private cache = new Map<string, LineState[]>();
    private wordPool: string[] = [];

    constructor() {
        this.initializeWordPool();
    }

    private initializeWordPool() {
        this.wordPool = [
            // group 1
            "apple", "beach", "cabin", "dust", "edge", "stone", "river", "tree", "leaf", "flower",
            "grass", "seed", "soil", "sand", "rock", "hill", "path", "road", "street", "house",
            "room", "door", "window", "wall", "roof", "floor", "desk", "chair", "table", "book",
            "pen", "paper", "bag", "box", "cup", "plate", "bowl", "spoon", "fork", "knife",
            "food", "bread", "milk", "water", "tea", "fruit", "pear", "peach", "plum", "grape",
            "melon", "berry", "nut", "bean", "corn", "rice", "oat", "wheat", "fish", "bird",
            "cat", "dog", "cow", "sheep", "goat", "pig", "horse", "deer", "bear", "wolf",
            "fox", "lion", "tiger", "seal", "whale", "crab", "frog", "toad", "snake", "worm",
            "bee", "ant", "fly", "spider", "moth", "fern", "moss", "pine", "oak", "maple",
            "birch", "willow", "ash", "elm", "palm", "rose", "lily", "daisy", "tulip", "iris",
            // group 2
            "about", "above", "actor", "acute", "admit", "adopt", "adult", "after", "again", "agent",
            "agree", "ahead", "alarm", "album", "alert", "alike", "alive", "allow", "alone", "along",
            "alter", "among", "anger", "angle", "angry", "apart", "appeal", "apron", "arena", "argue",
            "arise", "array", "arrow", "aside", "asset", "audio", "audit", "avoid", "award", "aware",
            "awful", "back", "bacon", "badge", "baker", "ball", "band", "bank", "base", "basic",
            "basil", "basin", "basis", "bath", "baton", "bayou", "bead", "beak", "beam", "beast",
            "beat", "beauty", "beef", "beer", "beet", "begin", "begun", "being", "belief", "bell",
            "belly", "below", "bench", "bend", "best", "bible", "bike", "bill", "bind", "bingo",
            "birth", "bite", "black", "blade", "blame", "blank", "blast", "blaze", "bleed", "blend",
            "blind", "blink", "block", "blond", "blood", "bloom", "blow", "blue", "blunt", "blush",
            // group 3
            "board", "boast", "boat", "body", "boil", "bold", "bolt", "bomb", "bond", "bone",
            "bonus", "boom", "boost", "boot", "booth", "border", "bore", "boss", "both", "bough",
            "bound", "boy", "brace", "brain", "brake", "branch", "brand", "brass", "brave", "break",
            "breast", "breath", "breezy", "brick", "bride", "bridge", "brief", "bright", "brim", "bring",
            "brisk", "broad", "broil", "broke", "bronze", "brook", "broom", "broth", "brown", "brush",
            "bubble", "bucket", "buckle", "bud", "budget", "buffet", "bugle", "build", "built", "bulb",
            "bulk", "bull", "bullet", "bump", "bunch", "bundle", "bunk", "bunny", "burden", "bureau",
            "burn", "burst", "bush", "busy", "butler", "butter", "button", "buyer", "buzz", "cable",
            "cactus", "cage", "cake", "calf", "calm", "came", "camel", "camera", "camp", "canal",
            "candle", "candy", "cane", "canoe", "canopy", "canvas", "canyon", "cape", "capital", "captain",
            // group 4
            "car", "card", "care", "cargo", "carol", "carpet", "carrot", "carry", "cart", "carve",
            "case", "cash", "cask", "cast", "castle", "catch", "cater", "cattle", "cause", "cave",
            "caviar", "cavity", "cedar", "celery", "cell", "cellar", "cello", "cement", "census", "center",
            "cereal", "chain", "chalk", "chamber", "chance", "change", "channel", "chapel", "chapter", "char",
            "charcoal", "charge", "charm", "chart", "chase", "chasm", "cheap", "cheat", "check", "cheek",
            "cheer", "cheese", "chef", "cherry", "chess", "chest", "chew", "chick", "chief", "child",
            "chili", "chill", "chime", "chin", "china", "chip", "chirp", "chisel", "choir", "choke",
            "choose", "chop", "chord", "chore", "chorus", "chose", "chrome", "chubby", "chuck", "chunk",
            "church", "cider", "cigar", "cinder", "circle", "circus", "cite", "citizen", "city", "civic",
            // group 5
            "civil", "clad", "claim", "clam", "clamp", "clan", "clap", "clasp", "class", "clause",
            "claw", "clay", "clean", "clear", "cleat", "cleft", "clerk", "clever", "click", "client",
            "cliff", "climate", "climb", "cling", "clinic", "clip", "cloak", "clock", "clod", "clog",
            "clone", "close", "closet", "cloth", "cloud", "clove", "clown", "club", "cluck", "clue",
            "clump", "clumsy", "clung", "cluster", "coach", "coal", "coast", "coat", "cobalt", "cobra",
            "cobweb", "cocoa", "coconut", "cod", "code", "coffee", "coffin", "cog", "coil", "coin",
            "coke", "cold", "collar", "collie", "colony", "color", "colt", "column", "comb", "combat",
            "come", "comedy", "comet", "comfort", "comic", "comma", "common", "compact", "company", "compare",
            // group 6
            "compass", "compel", "complex", "comply", "comrade", "concise", "concrete", "condor", "cone", "confer",
            "conga", "conic", "connect", "consul", "contest", "context", "contract", "control", "convert", "convex",
            "convey", "convoy", "cook", "cookie", "cool", "coop", "cope", "copper", "copy", "coral",
            "cord", "core", "cork", "corner", "cornet", "corps", "cosmic", "cost", "costume", "cottage",
            "cotton", "couch", "cough", "could", "council", "counsel", "count", "counter", "country", "county",
            "coup", "couple", "courage", "course", "court", "cousin", "cove", "cover", "covet", "coward",
            "coyote", "crack", "cradle", "craft", "crag", "cram", "cramp", "cranberry", "crane", "crank",
            "crash", "crate", "crater", "cravat", "crave", "craw", "crawl", "crayon", "craze", "crazy",
            "creak", "cream", "create", "credit", "creed", "creek", "creep", "crepe", "cress", "crest",
            // group 7
            "crew", "crib", "cricket", "cried", "crier", "crime", "crimson", "cringe", "cripple", "crisis",
            "crisp", "critic", "croak", "crock", "crocus", "crony", "crook", "crop", "cross", "croup",
            "crow", "crowd", "crown", "crude", "cruel", "crumb", "crumple", "crush", "crust", "crutch",
            "cry", "crypt", "crystal", "cub", "cube", "cuckoo", "cucumber", "cuff", "cult", "culture",
            "cupboard", "curb", "curd", "cure", "curfew", "curl", "currant", "current", "curry", "curse",
            "curve", "cushion", "custard", "custom", "cut", "cute", "cutter", "cycle", "cyclone", "cynic",
            "cypress", "dad", "dagger", "daily", "dairy", "dale", "dally", "dam", "damage", "dame",
            "damp", "dance", "dandy", "danger", "dapple", "dare", "dark", "darling", "darn", "dart",
            // group 8
            "dash", "date", "datum", "daub", "daughter", "dawn", "daze", "dazzle", "deacon", "dead",
            "deaf", "deal", "dealer", "dean", "dear", "death", "debar", "debate", "debit", "debris",
            "debt", "decade", "decay", "decent", "decide", "deck", "declare", "decline", "decor", "decoy",
            "decrease", "decree", "deduct", "deed", "deep", "defeat", "defect", "defend", "defer",
            "deficit", "defile", "define", "deform", "defray", "defy", "degree", "delay", "delegate", "delight",
            "deliver", "dell", "delta", "deluge", "delve", "demand", "demean", "demerit", "demise", "demo",
            "demote", "demur", "den", "denial", "denote", "denounce", "dense", "density", "dent", "dental",
            "dentist", "deny", "depart", "depend", "depict", "deplore", "deport", "depose", "deposit",
            // group 9
            "depot", "depth", "deputy", "derby", "derive", "dervish", "descend", "descent", "describe", "desert",
            "deserve", "design", "desire", "desolate", "despair", "despise", "despite", "despot", "dessert", "destiny",
            "destroy", "detach", "detail", "detain", "detect", "deter", "detest", "detour", "deuce", "develop",
            "deviate", "device", "devil", "devise", "devoid", "devote", "devour", "devout", "dew", "diagram",
            "dial", "dialect", "dialogue", "diameter", "diamond", "diary", "dice", "dictate", "diction", "dictionary",
            "did", "die", "diet", "differ", "difficult", "diffuse", "dig", "digest", "digger", "digit",
            "dignity", "dike", "dilute", "dim", "dime", "diminish", "dimple", "din", "dine", "diner",
            "dinghy", "dingle", "dinner", "dint", "dip", "diphthong", "diploma", "dire", "direct", "director",
            // group 10
            "dirge", "dirk", "dirt", "dirty", "disable", "disarm", "disaster", "disavow", "disband", "discard",
            "discern", "discharge", "disciple", "discipline", "disclose", "discomfit", "discord", "discount", "discourse", "discover",
            "discreet", "discrepant", "discretion", "discuss", "disdain", "disease", "disfavor", "disfigure", "disgrace", "disguise",
            "disgust", "dish", "dishevel", "dishonest", "dishonor", "disinfect", "disinherit", "disintegrate", "dislike", "dislocate",
            "dislodge", "disloyal", "dismal", "dismantle", "dismay", "dismember", "dismiss", "dismount", "disobey", "disorder",
            "disown", "disparage", "disparate", "disparity", "dispatch", "dispel", "dispense", "disperse", "displace", "display",
            "displease", "dispose", "disprove", "dispipe", "disqualify", "disquiet", "disregard", "disrepute", "disrespect", "disrobe",
            "disrupt", "dissatisfy", "dissect", "dissemble", "disseminate", "dissent", "dissertation", "disservice", "dissident", "dissimilar",
            "dissipate", "dissolve", "dissonant", "dissuade", "distance", "distant", "distaste", "distemper", "distend", "distich",
            "distill", "distinct", "distinguish", "distort", "distract", "distrain", "distress", "distribute", "district", "distrust",
            "disturb", "disunion", "disuse", "ditch", "ditty", "diurnal", "divan", "dive", "diverge", "diverse",
            "diversion", "diversity", "divert", "divest", "divide", "dividend", "divine", "diviner", "divinity", "divisible",
            "division", "divisor", "divorce", "divulge", "dizzy", "do", "docile", "dock", "doctor", "doctrine",
            "document", "dodge", "doe", "doer", "dogma", "dogmatic", "dole", "doll", "dollar", "domain",
            "dome", "domestic", "domicile", "dominant", "dominate", "domineer", "dominion", "domino", "don", "donation",
            "done", "donkey", "donor", "doom", "dormant", "dormitory", "dormouse", "dose", "dot", "double",
            "doublet", "doubt", "doubtful", "dough", "doughnut", "doughty", "dour", "douse", "dove", "dowager",
            "dowdy", "dower", "downcast", "downfall", "downright", "downy", "dowry"
        ];
    }

    private allocateAnchor(usedAnchors: Set<string>): string {
        for (const word of this.wordPool) {
            if (!usedAnchors.has(word)) {
                usedAnchors.add(word);
                return word;
            }
        }
        let counter = 1;
        while (true) {
            const word = `anchor_${counter}`;
            if (!usedAnchors.has(word)) {
                usedAnchors.add(word);
                return word;
            }
            counter++;
        }
    }

    getAnchoredContent(filePath: string): string {
        const absolutePath = path.resolve(filePath);
        let lineStates = this.cache.get(absolutePath);

        if (!lineStates) {
            const content = fs.readFileSync(absolutePath, 'utf8');
            const hasTrailingNewline = content.endsWith('\n');
            const lines = hasTrailingNewline ? content.slice(0, -1).split('\n') : content.split('\n');
            const usedAnchors = new Set<string>();

            lineStates = lines.map(line => {
                const anchor = this.allocateAnchor(usedAnchors);
                return { anchor, text: line };
            });

            this.cache.set(absolutePath, lineStates);
        }

        return lineStates.map(ls => `${ls.anchor}§${ls.text}`).join('\n');
    }

    applyAnchoredEdit(filePath: string, startAnchor: string, endAnchor: string, content: string): void {
        const absolutePath = path.resolve(filePath);
        let lineStates = this.cache.get(absolutePath);

        if (!lineStates) {
            this.getAnchoredContent(absolutePath);
            lineStates = this.cache.get(absolutePath)!;
        }

        const startIndex = lineStates.findIndex(ls => ls.anchor === startAnchor);
        if (startIndex === -1) {
            throw new Error(`Start anchor "${startAnchor}" not found`);
        }

        const endIndex = lineStates.findIndex(ls => ls.anchor === endAnchor);
        if (endIndex === -1) {
            throw new Error(`End anchor "${endAnchor}" not found`);
        }

        if (startIndex > endIndex) {
            throw new Error(`Invalid range: start anchor "${startAnchor}" is after end anchor "${endAnchor}"`);
        }

        const originalContent = fs.readFileSync(absolutePath, 'utf8');
        const hasTrailingNewline = originalContent.endsWith('\n');

        const oldLines = lineStates.map(ls => ls.text);
        const cleanContent = content.endsWith('\n') ? content.slice(0, -1) : content;
        const newEditLines = cleanContent.split('\n');

        const updatedLines = [
            ...oldLines.slice(0, startIndex),
            ...newEditLines,
            ...oldLines.slice(endIndex + 1)
        ];

        const fileContentToWrite = updatedLines.join('\n') + (hasTrailingNewline ? '\n' : '');
        fs.writeFileSync(absolutePath, fileContentToWrite, 'utf8');

        // Collect all anchors in the file (unchanged prefix, suffix, and the old edit segment) to avoid duplicate allocations
        const usedAnchors = new Set<string>();
        for (let i = 0; i < lineStates.length; i++) {
            usedAnchors.add(lineStates[i].anchor);
        }

        // Diff only the edited range
        const oldEditSegment = lineStates.slice(startIndex, endIndex + 1);
        const oldEditLines = oldEditSegment.map(ls => ls.text);
        const diffs = diffLines(oldEditLines.join('\n'), cleanContent);

        const reconciledEditStates: LineState[] = [];
        let oldEditIndex = 0;

        for (const change of diffs) {
            const changeLines = change.value.split('\n');
            if (changeLines.length > 1 && changeLines[changeLines.length - 1] === '') {
                changeLines.pop();
            }

            if (change.removed) {
                oldEditIndex += changeLines.length;
            } else if (change.added) {
                for (const line of changeLines) {
                    const anchor = this.allocateAnchor(usedAnchors);
                    reconciledEditStates.push({ anchor, text: line });
                }
            } else {
                for (let i = 0; i < changeLines.length; i++) {
                    const oldLs = oldEditSegment[oldEditIndex];
                    if (oldLs) {
                        reconciledEditStates.push({ anchor: oldLs.anchor, text: oldLs.text });
                        usedAnchors.add(oldLs.anchor);
                    } else {
                        const anchor = this.allocateAnchor(usedAnchors);
                        reconciledEditStates.push({ anchor, text: changeLines[i] });
                    }
                    oldEditIndex++;
                }
            }
        }

        const finalLineStates = [
            ...lineStates.slice(0, startIndex),
            ...reconciledEditStates,
            ...lineStates.slice(endIndex + 1)
        ];

        this.cache.set(absolutePath, finalLineStates);
    }
}
