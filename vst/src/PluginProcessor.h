#pragma once

#include "Clips.h"
#include "Mixer.h"
#include "Sampler.h"

#include <juce_audio_processors/juce_audio_processors.h>

#include <array>
#include <atomic>

/**
 * Breakseq in Reason (docs/vst-spec.md): the page in the editor is the web
 * app; this side keeps the project in the song's state, reports Reason's
 * tempo, plays what the page's player schedules (Mixer) and plays the pieces
 * Song to MIDI froze when Reason sends notes (Sampler).
 */
class BreakseqProcessor final : public juce::AudioProcessor
{
public:
    BreakseqProcessor();

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    /** The host's tempo as last seen by processBlock; 0 until it says. */
    double getBpm() const { return bpm.load(); }

    /** The project as the page last saved it: a project file in base64, or empty in a new instance. */
    juce::String getProject() const;
    void setProject (const juce::String& base64);

    Mixer& getMixer() { return mixer; }
    Sampler& getSampler() { return sampler; }

    /** The bar's drag fields: Song to Audio's WAV, Song to MIDI's MIDI file and its reverb/delay. */
    enum class Field { audio, midi, space };

    using Clip = Clips::Clip;

    /** Message thread. Kept in the song's state, so the fields are there when it opens again. */
    Clip getClip (Field field) const { return clips.get ((size_t) field); }
    void setClip (Field field, Clip clip) { clips.set ((size_t) field, std::move (clip)); }

    /** What the bar says, from the page; not saved. Message thread. */
    juce::String status;
    bool busy = false;

private:
    std::atomic<double> bpm { 0.0 };
    Mixer mixer;
    Sampler sampler;
    Clips clips;

    juce::CriticalSection projectLock;
    juce::String project;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (BreakseqProcessor)
};
