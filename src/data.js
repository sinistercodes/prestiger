const path = require('path');

const SURVIVORS = [
    { name: "Dwight Fairfield", id: "Dwight" },
    { name: "Meg Thomas", id: "Meg" },
    { name: "Claudette Morel", id: "Claudette" },
    { name: "Jake Park", id: "Jake" },
    { name: "Nea Karlsson", id: "Nea" },
    { name: "Laurie Strode", id: "Laurie" },
    { name: "Ace Visconti", id: "Ace" },
    { name: 'William "Bill" Overbeck', id: "Bill" },
    { name: "Feng Min", id: "Feng" },
    { name: "David King", id: "Smoke" },
    { name: "Quentin Smith", id: "Quentin" },
    { name: "Detective David Tapp", id: "Eric" },
    { name: "Kate Denson", id: "Kate" },
    { name: "Adam Francis", id: "Adam" },
    { name: "Jeff Johansen", id: "Jeff" },
    { name: "Jane Romero", id: "Jane" },
    { name: 'Ashley "Ash" J. Williams', id: "Ash" },
    { name: "Nancy Wheeler", id: "Nancy" },
    { name: "Steve Harrington", id: "Steve" },
    { name: "Yui Kimura", id: "Yui" },
    { name: "Zarina Kassir", id: "Zarina" },
    { name: "Cheryl Mason", id: "S22" },
    { name: "Felix Richter", id: "S23" },
    { name: "Elodie Rakoto", id: "S24" },
    { name: "Yun-Jin Lee", id: "S25" },
    { name: "Jill Valentine", id: "S26" },
    { name: "Leon S. Kennedy", id: "S27" },
    { name: "Mikaela Reid", id: "S28" },
    { name: "Jonah Vasquez", id: "S29" },
    { name: "Yoichi Asakawa", id: "S30" },
    { name: "Haddie Kaur", id: "S31" },
    { name: "Ada Wong", id: "S32" },
    { name: "Rebecca Chambers", id: "S33" },
    { name: "Vittorio Toscano", id: "S34" },
    { name: "Thalita Lyra", id: "S35" },
    { name: "Renato Lyra", id: "S36" },
    { name: "Gabriel Soma", id: "S37" },
    { name: "Nicolas Cage", id: "S38" },
    { name: "Ellen Ripley", id: "S39" },
    { name: "Alan Wake", id: "S40" },
    { name: "Sable Ward", id: "S41" },
    { name: "Aestri Yazar (The Bard)", id: "S42" },
    { name: "Lara Croft", id: "S43" },
    { name: "Trevor Belmont", id: "S44" },
    { name: "Taurie Cain", id: "S45" },
    { name: "Orela Rose", id: "S46" },
    { name: "Rick Grimes", id: "S47" },
    { name: "Michonne", id: "S48" },
    { name: "Vee", id: "S49" },
    { name: "Dustin", id: "S50" },
    { name: "Eleven", id: "S51" },
    { name: "Kwon Tae-Young", id: "S52" }
];

const KILLERS = [
    { name: "Trapper", id: "Chuckles" },
    { name: "Wraith", id: "Bob" },
    { name: "Hillbilly", id: "HillBilly" },
    { name: "Nurse", id: "Nurse" },
    { name: "Shape", id: "Shape" },
    { name: "Hag", id: "Witch" },
    { name: "Doctor", id: "Killer07" },
    { name: "Huntress", id: "Bear" },
    { name: "Cannibal", id: "Cannibal" },
    { name: "Nightmare", id: "Nightmare" },
    { name: "Pig", id: "Pig" },
    { name: "Clown", id: "Clown" },
    { name: "Spirit", id: "Spirit" },
    { name: "Legion", id: "Legion" },
    { name: "Plague", id: "Plague" },
    { name: "Ghost Face", id: "Ghostface" },
    { name: "Demogorgon", id: "Demogorgon" },
    { name: "Oni", id: "Oni" },
    { name: "Deathslinger", id: "Gunslinger" },
    { name: "Executioner", id: "K20" },
    { name: "Blight", id: "K21" },
    { name: "Twins", id: "K22" },
    { name: "Trickster", id: "K23" },
    { name: "Nemesis", id: "K24" },
    { name: "Cenobite", id: "K25" },
    { name: "Artist", id: "K26" },
    { name: "Onryo", id: "K27" },
    { name: "Dredge", id: "K28" },
    { name: "Mastermind", id: "K29" },
    { name: "Knight", id: "K30" },
    { name: "Skull Merchant", id: "K31" },
    { name: "Singularity", id: "K32" },
    { name: "Xenomorph", id: "K33" },
    { name: "Good Guy", id: "K34" },
    { name: "Unknown", id: "K35" },
    { name: "Lich", id: "K36" },
    { name: "Dark Lord", id: "K37" },
    { name: "Houndmaster", id: "K38" },
    { name: "Ghoul", id: "K39" },
    { name: "Animatronic", id: "K40" },
    { name: "Krasue", id: "K41" },
    { name: "First", id: "K42" }
];

function sortCharacters(list) {
    return list.sort((a, b) => {
        const getNum = (id) => {
            const match = id.match(/[SK](\d+)/);
            return match ? parseInt(match[1]) : -1;
        };
        const numA = getNum(a.id);
        const numB = getNum(b.id);
        if (numA !== -1 && numB !== -1) return numA - numB;
        return 0;
    });
}

function loadGameData(appPath) {
    const itemsData = require(path.join(appPath, 'data', 'Items.json'));
    const addonsData = require(path.join(appPath, 'data', 'Addons.json'));
    const offeringsData = require(path.join(appPath, 'data', 'Offerings.json'));

    const contentNameMap = new Map();
    [...itemsData, ...addonsData, ...offeringsData].forEach(item => {
        contentNameMap.set(item.ItemId, item.Name);
    });

    return { itemsData, addonsData, offeringsData, contentNameMap };
}

module.exports = { SURVIVORS, KILLERS, sortCharacters, loadGameData };
